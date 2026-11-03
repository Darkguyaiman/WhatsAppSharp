using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Authentication;
using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Configuration;
using MessagingApp.Data;
using MessagingApp.Hubs;
using MessagingApp.Services;
using Microsoft.AspNetCore.ResponseCompression;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using System.Net;

DotEnv.LoadApplicationEnvironment();

// Local provisioning command. No web host or database is started.
if (args.Contains("--generate-vapid-keys"))
{
    var keys = WebPushService.GenerateKeys();
    Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { keys.PublicKey, keys.PrivateKey },
        new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
    return;
}

var builder = WebApplication.CreateBuilder(args);

// Keep the old local key scope after moving the project into src/. Published
// releases use a fixed name so cookie/push keys survive release-folder changes.
var protection = builder.Services.AddDataProtection();
var protectionName = builder.Configuration["DataProtection:ApplicationName"];
if (string.IsNullOrWhiteSpace(protectionName))
{
    var directory = new DirectoryInfo(builder.Environment.ContentRootPath);
    while (directory is not null)
    {
        if (File.Exists(Path.Combine(directory.FullName, "MessagingApp.slnx")))
        {
            protectionName = directory.FullName + Path.DirectorySeparatorChar;
            break;
        }
        directory = directory.Parent;
    }
}
protection.SetApplicationName(string.IsNullOrWhiteSpace(protectionName) ? "MessagingApp" : protectionName);
var keyDirectory = builder.Configuration["DataProtection:KeyPath"];
if (!string.IsNullOrWhiteSpace(keyDirectory))
    protection.PersistKeysToFileSystem(new DirectoryInfo(keyDirectory));

var trustedProxy = builder.Configuration["Hosting:TrustedProxy"];
if (!string.IsNullOrWhiteSpace(trustedProxy))
{
    var proxyAddress = IPAddress.Parse(trustedProxy);
    builder.Services.Configure<ForwardedHeadersOptions>(options =>
    {
        options.ForwardedHeaders = ForwardedHeaders.XForwardedFor | ForwardedHeaders.XForwardedProto;
        options.KnownIPNetworks.Clear();
        options.KnownProxies.Clear();
        options.KnownProxies.Add(proxyAddress);
    });
}

// Prefer an explicit connection string (tests/hosting). Otherwise build from MYSQL_* env vars.
var connectionString = builder.Configuration.GetConnectionString("DefaultConnection");
if (string.IsNullOrWhiteSpace(connectionString))
    connectionString = MySqlSettings.BuildConnectionString();

builder.Services.AddDbContext<AppDbContext>(options =>
    options.UseMySQL(connectionString));

// Add Authentication
var authentication = builder.Services.AddAuthentication(CookieAuthenticationDefaults.AuthenticationScheme)
    .AddCookie(options =>
    {
        options.LoginPath = "/Account/Login";
        options.LogoutPath = "/Account/Logout";
        options.AccessDeniedPath = "/Account/Login";
        options.ExpireTimeSpan = TimeSpan.FromDays(30);
        options.SlidingExpiration = true;
        options.Cookie.HttpOnly = true;
        options.Cookie.SameSite = SameSiteMode.Lax;
        options.Events.OnValidatePrincipal = async context =>
        {
            var id = context.Principal?.FindFirstValue(ClaimTypes.NameIdentifier);
            var db = context.HttpContext.RequestServices.GetRequiredService<AppDbContext>();
            if (!int.TryParse(id, out var userId) || !await db.Users.AnyAsync(u => u.Id == userId))
            {
                context.RejectPrincipal();
                await context.HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
            }
        };
    });

var googleClientId = builder.Configuration["Authentication:Google:ClientId"];
var googleClientSecret = builder.Configuration["Authentication:Google:ClientSecret"];
if (!string.IsNullOrWhiteSpace(googleClientId) && !string.IsNullOrWhiteSpace(googleClientSecret))
{
    authentication.AddGoogle(options =>
    {
        options.ClientId = googleClientId;
        options.ClientSecret = googleClientSecret;
        options.UsePkce = true;
        options.Events.OnCreatingTicket = async ticket =>
        {
            if (!GoogleProfile.HasVerifiedEmail(ticket.User))
                throw new InvalidOperationException("Google email must be verified.");
            var service = ticket.HttpContext.RequestServices.GetRequiredService<GoogleAccountService>();
            var user = await service.FindOrCreateAsync(
                ticket.Principal!.FindFirstValue(ClaimTypes.NameIdentifier)!,
                ticket.Principal!.FindFirstValue(ClaimTypes.Email)!,
                ticket.Principal!.FindFirstValue(ClaimTypes.Name));
            ticket.Principal = AccountPrincipal.Create(user);
        };
        options.Events.OnRemoteFailure = context =>
        {
            var logger = context.HttpContext.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("GoogleSignIn");
            // Do not log callback URLs, authorization codes, tokens, or profile data.
            logger.LogWarning("Google sign-in failed. Failure type: {FailureType}", context.Failure?.GetType().Name ?? "Unknown");
            context.HandleResponse();
            context.Response.Redirect("/Account/Login?error=google");
            return Task.CompletedTask;
        };
    });
}
builder.Services.AddScoped<GoogleAccountService>();
builder.Services.AddSingleton<CallService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<CallService>());
builder.Services.AddHostedService<SocialMaintenanceService>();

builder.Services.AddAuthorization();
builder.Services.AddAntiforgery(options => options.HeaderName = "RequestVerificationToken");
builder.Services.AddResponseCompression(options =>
{
    // Compress public assets only; personalized HTML and API responses are excluded below.
    options.EnableForHttps = true;
    options.Providers.Add<BrotliCompressionProvider>();
    options.Providers.Add<GzipCompressionProvider>();
});
builder.Services.AddSingleton<WebPushService>();
builder.Services.AddHostedService(provider => provider.GetRequiredService<WebPushService>());

// Add SignalR
builder.Services.AddSignalR();

// Register Application Services
builder.Services.AddSingleton<IUserPresenceService, UserPresenceService>();
builder.Services.AddScoped<IAuthService, AuthService>();
builder.Services.AddScoped<IConversationService, ConversationService>();
builder.Services.AddScoped<IMessageService, MessageService>();
builder.Services.AddScoped<MessageActionsService>();
builder.Services.AddSingleton<DeliveryTokenService>();
builder.Services.AddScoped<IFileStorageService, FileStorageService>();

// Add Razor Pages
builder.Services.AddRazorPages(options =>
{
    options.Conventions.AuthorizeFolder("/Chat");
    options.Conventions.AuthorizeFolder("/Status");
    options.Conventions.AuthorizeFolder("/Communities");
    options.Conventions.AddPageRoute("/Chat/Index", "Calls");
    options.Conventions.AddPageRoute("/Chat/Index", "Statuses");
    options.Conventions.AddPageRoute("/Chat/Index", "Media");
    options.Conventions.AddPageRoute("/Chat/Index", "Communities");
    options.Conventions.AddPageRoute("/Chat/Index", "Communities/{communityId:int}");
});

var app = builder.Build();

// Apply database migrations and remove legacy demo fixtures.
using (var scope = app.Services.CreateScope())
{
    var services = scope.ServiceProvider;
    try
    {
        var context = services.GetRequiredService<AppDbContext>();
        await DatabaseInitializer.InitializeAsync(context);
    }
    catch (Exception ex)
    {
        var logger = services.GetRequiredService<ILogger<Program>>();
        logger.LogError(ex, "An error occurred while initializing the database.");
        throw;
    }
}

// Configure HTTP Pipeline
if (!string.IsNullOrWhiteSpace(trustedProxy))
    app.UseForwardedHeaders();

if (!app.Environment.IsDevelopment())
{
    app.UseExceptionHandler("/Error");
    app.UseHsts();
    if (app.Configuration.GetValue("Hosting:UseHttpsRedirection", true))
        app.UseWhen(context => context.Request.Path != "/health", branch => branch.UseHttpsRedirection());
}

app.UseWhen(context => context.Request.Path.StartsWithSegments("/css") || context.Request.Path.StartsWithSegments("/js") ||
    context.Request.Path.StartsWithSegments("/images"), branch => branch.UseResponseCompression());
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        context.Context.Response.Headers["X-Content-Type-Options"] = "nosniff";
        context.Context.Response.Headers.CacheControl = context.File.Name == "sw.js"
            ? "no-cache" : "public,max-age=3600";
    }
});

app.UseRouting();

app.UseAuthentication();
app.UseAuthorization();
app.UseAntiforgery();
app.Use(async (context, next) =>
{
    context.Response.Headers.CacheControl = "no-store";
    context.Response.Headers["X-Content-Type-Options"] = "nosniff";
    await next();
});

// File Upload API Endpoint
app.MapPost("/api/upload", UploadEndpoint.Handle).RequireAuthorization();

app.MapHub<ChatHub>("/hubs/chat");

// Startup initializes MySQL before requests are accepted, so this also checks readiness.
app.MapGet("/health", () => Results.Ok(new { status = "ok" })).AllowAnonymous();

app.MapRazorPages();

// Redirect root to /Chat/Index
app.MapGet("/", () => Results.Redirect("/Chat"));

app.Run();
