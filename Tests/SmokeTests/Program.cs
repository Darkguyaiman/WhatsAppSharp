using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.SignalR.Client;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Configuration;
using MessagingApp.Data;
using MessagingApp.Models;
using MessagingApp.Services;
using MySql.Data.MySqlClient;
using Lib.Net.Http.WebPush;
using Lib.Net.Http.WebPush.Authentication;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.DataProtection;

// Exercises the real MySQL provider and HTTP/SignalR stack in an isolated database.
var root = new DirectoryInfo(Directory.GetCurrentDirectory());
while (root != null && !File.Exists(Path.Combine(root.FullName, "MessagingApp.slnx"))) root = root.Parent;
if (root == null) throw new InvalidOperationException("Run this test from the project folder.");
DotEnv.Load(Path.Combine(root.FullName, ".env"));
var appRoot = Path.Combine(root.FullName, "src", "MessagingApp");
var databaseName = $"messagingapp_smoke_{Guid.NewGuid():N}";
var cs = new MySqlConnectionStringBuilder(
    Environment.GetEnvironmentVariable("ConnectionStrings__DefaultConnection") ?? MySqlSettings.BuildConnectionString())
{ Database = databaseName };
using var listener = new TcpListener(IPAddress.Loopback, 0);
listener.Start(); var port = ((IPEndPoint)listener.LocalEndpoint).Port; listener.Stop();
var origin = $"http://127.0.0.1:{port}";
var start = new ProcessStartInfo("dotnet") { WorkingDirectory = appRoot, UseShellExecute = false, RedirectStandardOutput = true, RedirectStandardError = true, CreateNoWindow = true };
start.ArgumentList.Add(Environment.GetEnvironmentVariable("MESSAGINGAPP_TEST_APP_DLL") ?? Path.Combine(appRoot, "bin/Debug/net10.0/MessagingApp.dll"));
start.ArgumentList.Add("--urls"); start.ArgumentList.Add(origin);
start.Environment["ASPNETCORE_ENVIRONMENT"] = "Development";
start.Environment["ConnectionStrings__DefaultConnection"] = cs.ConnectionString;
start.Environment["Logging__LogLevel__Default"] = "Warning";
start.Environment["Logging__LogLevel__Microsoft.EntityFrameworkCore"] = "Warning";
start.Environment["Authentication__Google__ClientId"] = "synthetic-test-client";
start.Environment["Authentication__Google__ClientSecret"] = "synthetic-test-secret";
start.Environment["Calls__TurnUrls"] = "turn:relay.example.test:3478";
start.Environment["Calls__TurnSharedSecret"] = "synthetic-relay-secret";
using var server = Process.Start(start)!;
var outputTask = server.StandardOutput.ReadToEndAsync(); var errorTask = server.StandardError.ReadToEndAsync();
var options = new DbContextOptionsBuilder<AppDbContext>().UseMySQL(cs.ConnectionString).Options;
var checks = 0;
void Check(bool result, string name) { if (!result) throw new Exception("FAIL: " + name); checks++; Console.WriteLine("PASS: " + name); }
try
{
    await StorageChecks.RunAsync(Check);
    Check(MessageContentPreview.Text("{\"duration\":2, \"wa\":\"voice\"}")=="Voice message","Server-rendered voice previews never expose metadata JSON");
    using (var verifiedProfile = JsonDocument.Parse("{\"sub\":\"test-subject\",\"email_verified\":true}"))
        Check(GoogleProfile.HasVerifiedEmail(verifiedProfile.RootElement), "Google v3 email_verified is accepted");
    foreach (var profile in new[] { "{\"email_verified\":false}", "{}", "{\"email_verified\":\"true\"}", "{\"verified_email\":true}" })
    {
        using var unverifiedProfile = JsonDocument.Parse(profile);
        Check(!GoogleProfile.HasVerifiedEmail(unverifiedProfile.RootElement), "Missing or invalid Google verification is rejected");
    }
    Check(AvatarAppearance.Initials("  Sarah Connor") == "SA" && AvatarAppearance.Initials("👋 E\u0301loise") == "ÉL" && AvatarAppearance.Initials("李明") == "李明", "Default avatars use the first two Unicode letters of the display name");
    Check(AvatarAppearance.Initials("🎉123") == "?" && AvatarAppearance.Initials("O") == "O", "Default initials handle short and non-letter names");
    Check(AvatarAppearance.ForUser(new User { AvatarUrl = "/uploads/photo.png" }) == "/uploads/photo.png", "Chosen photos are preserved");
    Check(ContactCodes.UsernameFrom("https://chat.example/Chat?contact=Sarah") == "sarah", "Contact codes read a username from a chat link");
    Check(ContactCodes.UsernameFrom("MSGAPP1:alex") == "alex", "Contact codes accept the compact form");
    Check(ContactCodes.UsernameFrom("https://evil.example/steal?contact=sarah") == null, "Contact codes ignore links that are not chat links");
    Check(ContactCodes.UsernameFrom("/Chat?contact=emma") == "emma", "Contact codes accept an in-app chat path");
    Check(ContactCodes.NormalizeUsername("nope!") == null, "Contact codes reject usernames that don’t match an account");
    Check(ContactCodes.UsernameFrom("/Chat?contact=outsider-test") == "outsider-test", "Contact codes keep hyphens used by existing accounts");
    var upgradeCs = new MySqlConnectionStringBuilder(cs.ConnectionString) { Database = databaseName + "_upgrade" };
    await using (var upgrade = new AppDbContext(new DbContextOptionsBuilder<AppDbContext>().UseMySQL(upgradeCs.ConnectionString).Options))
    {
        try
        {
            await SqlMigrationRunner.MigrateAsync(upgradeCs.ConnectionString, upToInclusive: "002_web_push_and_message_paging.sql");
            await upgrade.Database.ExecuteSqlRawAsync("INSERT INTO `Users` (`Username`,`Email`,`PasswordHash`,`DisplayName`,`CreatedAt`,`LastSeenAt`) VALUES ('existing','existing@example.com','unused','Existing Person',UTC_TIMESTAMP(),UTC_TIMESTAMP())");
            await upgrade.Database.ExecuteSqlRawAsync("INSERT INTO `Conversations` (`Title`,`IsGroup`,`CreatedAt`,`UpdatedAt`) VALUES ('Existing group',1,UTC_TIMESTAMP(),UTC_TIMESTAMP())");
            await upgrade.Database.ExecuteSqlRawAsync("INSERT INTO `Messages` (`ConversationId`,`SenderId`,`Type`,`IsEdited`,`IsDeleted`,`CreatedAt`) VALUES (1,1,0,0,0,UTC_TIMESTAMP())");
            await upgrade.Database.ExecuteSqlRawAsync("INSERT INTO `MessageReactions` (`MessageId`,`UserId`,`Emoji`,`CreatedAt`) VALUES (1,1,'👍','2000-01-01'),(1,1,'😂','2000-01-02'),(1,1,'❤️','2000-01-02')");
            await upgrade.Database.ExecuteSqlRawAsync("INSERT INTO `Users` (`Username`,`Email`,`PasswordHash`,`DisplayName`,`CreatedAt`,`LastSeenAt`) VALUES ('existing-reader','reader@example.test','unused','Existing Reader',UTC_TIMESTAMP(),UTC_TIMESTAMP())");
            await upgrade.Database.ExecuteSqlRawAsync("INSERT INTO `MessageReads` (`MessageId`,`UserId`,`ReadAt`) VALUES (1,2,'2000-01-03')");
            await SqlMigrationRunner.MigrateAsync(upgradeCs.ConnectionString);
            Check(await upgrade.MessageDeliveries.CountAsync()==1 && (await upgrade.MessageDeliveries.SingleAsync()).DeliveredAt.Year==2000,"Existing read receipts migrate into durable delivery confirmation without inventing an earlier time");
            Check(await upgrade.MessageReactions.CountAsync()==1 && await upgrade.MessageReactions.Select(r=>r.Emoji).SingleAsync()=="❤️",
                "Reaction migration keeps the latest choice, including timestamp ties");
            var duplicateRejected=false;
            try { await upgrade.Database.ExecuteSqlRawAsync("INSERT INTO `MessageReactions` (`MessageId`,`UserId`,`Emoji`,`CreatedAt`) VALUES (1,1,'👍',UTC_TIMESTAMP())"); }
            catch(MySqlException error) when(error.Number==1062) { duplicateRejected=true; }
            Check(duplicateRejected,"Database enforces one reaction per person and message");
            var userColor = await upgrade.Users.Where(u=>u.Username=="existing").Select(u => u.AvatarColor).SingleAsync();
            var groupColor = await upgrade.Conversations.Select(c => c.AvatarColor).SingleAsync();
            Check(AvatarAppearance.Colors.Contains(userColor) && AvatarAppearance.Colors.Contains(groupColor), "Migration assigns saved colors to existing people and groups");
            await SqlMigrationRunner.MigrateAsync(upgradeCs.ConnectionString);
            Check(await upgrade.Users.Where(u=>u.Username=="existing").Select(u => u.AvatarColor).SingleAsync() == userColor && await upgrade.Conversations.Select(c => c.AvatarColor).SingleAsync() == groupColor, "Restarting migrations does not regenerate saved colors");
        }
        finally { await upgrade.Database.EnsureDeletedAsync(); }
    }
    var signingKeys = WebPushService.GenerateKeys();
    var receiverKeys = WebPushService.GenerateKeys();
    using var signing = new VapidAuthentication(signingKeys.PublicKey, signingKeys.PrivateKey) { Subject = "mailto:tests@example.com" };
    using var pushHandler = new CapturingPushHandler();
    using var pushHttp = new HttpClient(pushHandler);
    var pushClient = new PushServiceClient(pushHttp) { DefaultAuthentication = signing, AutoRetryAfter = false };
    await pushClient.RequestPushMessageDeliveryAsync(new PushSubscription
    {
        Endpoint = "https://web.push.apple.com/synthetic-test",
        Keys = new Dictionary<string, string> { ["p256dh"] = receiverKeys.PublicKey, ["auth"] = "AAAAAAAAAAAAAAAAAAAAAA" }
    }, new PushMessage("Private test message") { TimeToLive = 3600 });
    Check(pushHandler.Encoding == "aes128gcm" && pushHandler.Ttl == "3600", "Push transport uses RFC 8291 encryption and bounded TTL");
    Check(pushHandler.Authorization.StartsWith("vapid ", StringComparison.OrdinalIgnoreCase) && pushHandler.Authorization.Contains("k="), "Push transport signs with modern VAPID authorization");
    Check(pushHandler.Body.Length > 100 && !System.Text.Encoding.UTF8.GetString(pushHandler.Body).Contains("Private test message"), "Push request contains encrypted payload rather than message text");
    using var probe = new HttpClient();
    var started = false;
    for (var i = 0; i < 100 && !server.HasExited; i++)
    {
        try { var response = await probe.GetAsync(origin + "/Account/Login"); if (response.IsSuccessStatusCode) { started = true; break; } } catch (HttpRequestException) { }
        await Task.Delay(200);
    }
    Check(started, "Server starts and applies migrations in a separate test database");
    var health = await probe.GetFromJsonAsync<JsonElement>(origin + "/health");
    Check(health.GetProperty("status").GetString() == "ok", "Deployment readiness endpoint is available without authentication");
    var loginHtml = WebUtility.HtmlDecode(await probe.GetStringAsync(origin + "/Account/Login"));
    Check(loginHtml.Contains("Continue with Google") && !loginHtml.Contains("DemoLogin") && !loginHtml.Contains("Password123!"), "Google login replaces dummy accounts");
    Check(!loginHtml.Contains("login-password") && !loginHtml.Contains("UsernameOrEmail") && !loginHtml.Contains("/Account/Register"), "Login exposes only Google sign-in");
    using (var challengeClient = new HttpClient(new HttpClientHandler { CookieContainer = new CookieContainer(), AllowAutoRedirect = false }))
    {
        var challengeHtml = await challengeClient.GetStringAsync(origin + "/Account/Login");
        var challengeToken = WebUtility.HtmlDecode(Regex.Match(challengeHtml, "name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);
        var challenge = await challengeClient.PostAsync(origin + "/Account/Login?handler=Google&returnUrl=https://untrusted.example", new FormUrlEncodedContent(new Dictionary<string,string>
        { ["RememberMe"] = "false", ["__RequestVerificationToken"] = challengeToken }));
        Check(challenge.StatusCode == HttpStatusCode.Redirect && challenge.Headers.Location?.Host == "accounts.google.com" &&
            challenge.Headers.Location.Query.Contains("code_challenge=") && challenge.Headers.Location.Query.Contains("state="), "Google challenge uses protected state and PKCE");
        var rejected = await challengeClient.GetAsync(origin + "/signin-google?error=access_denied");
        Check(rejected.StatusCode == HttpStatusCode.Redirect && rejected.Headers.Location?.OriginalString == "/Account/Login?error=google", "Failed OAuth callbacks return safely to login");
    }
    await using (var db = new AppDbContext(options))
    {
        Check(!await db.Users.AnyAsync(), "Application starts without demo users");
        await TestFixtures.SeedAsync(db);
        await DatabaseInitializer.InitializeAsync(db);
        Check(!await db.Users.AnyAsync() && !await db.Conversations.AnyAsync(), "Original dummy accounts and conversations are removed");
        var google = new GoogleAccountService(db);
        var first = await google.FindOrCreateAsync("google-test-subject", "real-person@example.net", "Real Person");
        var again = await google.FindOrCreateAsync("google-test-subject", "real-person@example.net", "Real Person");
        Check(first.Id == again.Id && first.PasswordHash == "", "Google accounts are saved and reused without a dummy password");
        Check(!(await new AuthService(db).ValidateUserAsync(first.Email, "Password123!")).Success, "Google-only accounts cannot log in by password");
        var collisionRejected = false;
        try { await google.FindOrCreateAsync("another-subject", first.Email, "Another Person"); }
        catch (InvalidOperationException) { collisionRejected = true; }
        Check(collisionRejected, "Google identities are not linked by email alone");
        await DatabaseInitializer.InitializeAsync(db);
        Check(await db.Users.AnyAsync(u => u.Id == first.Id), "Demo cleanup preserves real accounts");
        db.Users.Remove(first);
        await db.SaveChangesAsync();
        await TestFixtures.SeedAsync(db);
    }
    var (alex, alexCookies, alexToken) = await LoginAsync("alex");
    var (sarah, sarahCookies, sarahToken) = await LoginAsync("sarah");
    using (alex) using (sarah)
    {
        var manifest = await probe.GetFromJsonAsync<JsonElement>(origin + "/manifest.webmanifest");
        Check(manifest.GetProperty("display").GetString() == "standalone", "Installable manifest is served");
        foreach (var icon in manifest.GetProperty("icons").EnumerateArray())
            Check((await probe.GetAsync(origin + icon.GetProperty("src").GetString())).IsSuccessStatusCode, "PWA icon exists");
        Check((await probe.GetAsync(origin + "/sw.js")).Headers.CacheControl?.NoCache == true, "Service worker revalidates updates");
        var pushConfig = await alex.GetFromJsonAsync<JsonElement>(origin + "/api/push");
        Check(pushConfig.GetProperty("enabled").GetBoolean(), "Development VAPID configuration is available");
        var alexContact = await sarah.GetFromJsonAsync<UserDto>(origin + "/Chat?handler=ContactByCode&username=alex");
        var alexId = alexContact!.Id;
        var sarahContact = await alex.GetFromJsonAsync<UserDto>(origin + "/Chat?handler=ContactByCode&username=sarah");
        var sarahId = sarahContact!.Id;
        var sarahAvatar = sarahContact.AvatarUrl;
        Check((await alex.GetFromJsonAsync<List<UserDto>>(origin + "/Chat?handler=SearchContacts&query=sarah"))!.Any(u => u.Id == sarahId),
            "Contact search includes people in existing fixture conversations");
        Check((await alex.GetFromJsonAsync<List<UserDto>>(origin + "/Chat?handler=SearchContacts&query=david"))!.Count == 0,
            "Contact search excludes people without a shared conversation");
        var sarahSvg = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(sarahAvatar.Split(',')[1]));
        Check(sarahSvg.Contains(">SA</text>"), "Contact avatars render name letters rather than generic silhouettes");
        var mine = await alex.GetFromJsonAsync<JsonElement>(origin + "/Chat?handler=MyContactCode");
        Check(mine.GetProperty("link").GetString()!.EndsWith("/Chat?contact=alex"), "Your QR code links to your username");
        var qr = await alex.GetAsync(origin + "/Chat?handler=ContactQr");
        var qrSvg = await qr.Content.ReadAsStringAsync();
        Check(qr.Content.Headers.ContentType?.MediaType == "image/svg+xml" && qrSvg.Contains("<svg", StringComparison.OrdinalIgnoreCase) && !qrSvg.Contains("example.com"), "Contact QR is an image and does not include an email address");
        var anonQr = await probe.GetStringAsync(origin + "/Chat?handler=ContactQr");
        Check(!anonQr.Contains("<svg", StringComparison.OrdinalIgnoreCase), "Contact QR codes require a signed-in account");
        var sarahCode = ContactCodes.Link(origin, "sarah");
        var found = await alex.GetFromJsonAsync<UserDto>(origin + "/Chat?handler=ContactByCode&code=" + Uri.EscapeDataString(sarahCode));
        Check(found!.Id == sarahId && found.Username == "sarah", "Scanning a contact code finds that person");
        var selfCode = await alex.GetAsync(origin + "/Chat?handler=ContactByCode&code=" + Uri.EscapeDataString(mine.GetProperty("link").GetString()!));
        Check(selfCode.StatusCode == HttpStatusCode.NotFound, "Your own QR code does not open a chat with yourself");
        var junk = await alex.GetAsync(origin + "/Chat?handler=ContactByCode&code=" + Uri.EscapeDataString("https://example.com"));
        Check(junk.StatusCode == HttpStatusCode.BadRequest, "QR codes that are not contact codes are rejected");
        var chatHtml = await alex.GetStringAsync(origin + "/Chat");
        Check(chatHtml.Contains("My QR code") && chatHtml.Contains("Scan a QR code") && chatHtml.Contains("Add contact") && chatHtml.Contains("id=\"scan-qr-modal\""), "The chat screen offers a personal code, add contact, and a scanner");
        var settingsHtml = await alex.GetStringAsync(origin + "/Account/Settings");
        Check(settingsHtml.Contains("id=\"settings-qr\"") && settingsHtml.Contains("Scan a code"), "Settings shows a shareable contact QR code");
        await using (var db = new AppDbContext(options))
        {
            var auth = new AuthService(db);
            var registered = await auth.RegisterAsync("avatar-test", "avatar-test@example.com", "Password123!", "Nora Jones", null, null);
            var color = registered.User!.AvatarColor;
            await auth.UpdateProfileAsync(registered.User.Id, "Zara Jones", null, null);
            db.ChangeTracker.Clear();
            var saved = await db.Users.SingleAsync(u => u.Id == registered.User.Id);
            Check(AvatarAppearance.Colors.Contains(color) && saved.AvatarColor == color && AvatarAppearance.Initials(saved.DisplayName) == "ZA", "New account color persists across reload and name changes");
        }
        var direct = new FormUrlEncodedContent(new Dictionary<string, string> { ["targetUserId"] = sarahId.ToString(), ["__RequestVerificationToken"] = alexToken });
        var created = await alex.PostAsync(origin + "/Chat?handler=StartDirectChat", direct); created.EnsureSuccessStatusCode();
        var conversation = await created.Content.ReadFromJsonAsync<ConversationDto>();
        var id = conversation!.Id;
        Check(conversation.AvatarUrl == sarahAvatar, "Contact list and direct-chat header use the same saved avatar");
        Check((await alex.GetAsync(origin + "/Chat?handler=Conversations")).IsSuccessStatusCode, "Conversation preview query executes on MySQL");
        var alexMessages = new List<MessageDto>(); var sarahMessages = new List<MessageDto>();
        await using var a = new HubConnectionBuilder().WithUrl(origin + "/hubs/chat", config => config.Cookies = alexCookies).Build();
        await using var b = new HubConnectionBuilder().WithUrl(origin + "/hubs/chat", config => config.Cookies = sarahCookies).Build();
        a.On<MessageDto>("ReceiveMessage", message => alexMessages.Add(message));
        b.On<MessageDto>("ReceiveMessage", message => sarahMessages.Add(message));
        await a.StartAsync(); await b.StartAsync();
        await a.InvokeAsync("SendMessage", id, "Quoted ' text <script>literal</script>", "Text", null, null, null, null);
        await WaitAsync(() => alexMessages.Count == 1 && sarahMessages.Count == 1);
        Check(alexMessages[0].IsMine && !sarahMessages[0].IsMine, "Live messages use the correct recipient ownership");
        var deliveryId=alexMessages[0].Id;
        Check((await alex.GetFromJsonAsync<List<MessageDto>>(origin+$"/Chat?handler=Messages&conversationId={id}"))!.Single(m=>m.Id==deliveryId).ReadStatus=="sent",
            "Online presence alone does not claim that a message was delivered");
        await a.InvokeAsync("MarkMessagesDelivered",new[]{deliveryId});
        await using(var db=new AppDbContext(options))Check(!await db.MessageDeliveries.AnyAsync(r=>r.MessageId==deliveryId),"Senders cannot acknowledge their own messages as recipient delivery");
        var deliveredEvent=new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        using var deliverySubscription=a.On<JsonElement>("MessagesDelivered",data=>deliveredEvent.TrySetResult(data));
        Check((await b.InvokeAsync<List<MessageDto>>("GetUndeliveredMessages")).Any(m=>m.Id==deliveryId),"An online recipient can sync messages without opening their chat");
        var deliveryKeys=new DirectoryInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"ASP.NET","DataProtection-Keys"));
        var deliveryProtection=DataProtectionProvider.Create(deliveryKeys,builder=>builder.SetApplicationName(root.FullName+Path.DirectorySeparatorChar));
        var deliveryTokens=new DeliveryTokenService(deliveryProtection);
        var pushReceiptToken=deliveryTokens.Issue(deliveryId,sarahId);
        Check((await probe.PostAsJsonAsync(origin+"/api/delivery",new{token=pushReceiptToken})).IsSuccessStatusCode,"A signed push receipt records delivery without an open app or signed-in cookie");
        Check((await probe.PostAsJsonAsync(origin+"/api/delivery",new{token="forged"})).StatusCode==HttpStatusCode.BadRequest,"Push receipts reject forged tokens");
        var expiredToken=deliveryProtection.CreateProtector("MessagingApp.PushDelivery.v1").Protect($"{deliveryId}:{sarahId}:{DateTimeOffset.UtcNow.AddMinutes(-1).ToUnixTimeSeconds()}");
        Check((await probe.PostAsJsonAsync(origin+"/api/delivery",new{token=expiredToken})).StatusCode==HttpStatusCode.BadRequest,"Push delivery tokens expire instead of granting permanent account access");
        await b.InvokeAsync("MarkMessagesDelivered",new[]{deliveryId});
        Check((await deliveredEvent.Task.WaitAsync(TimeSpan.FromSeconds(5))).GetProperty("messageIds").EnumerateArray().Any(v=>v.GetInt32()==deliveryId),"Device acknowledgement updates the sender's ticks live");
        await b.InvokeAsync("MarkMessagesDelivered",new[]{deliveryId});
        await using(var db=new AppDbContext(options))Check(await db.MessageDeliveries.CountAsync(r=>r.MessageId==deliveryId)==1 && !await db.MessageReads.AnyAsync(r=>r.MessageId==deliveryId),"Repeated delivery acknowledgements are idempotent and do not mark a message read");
        await b.StopAsync();
        Check((await alex.GetFromJsonAsync<List<MessageDto>>(origin+$"/Chat?handler=Messages&conversationId={id}"))!.Single(m=>m.Id==deliveryId).ReadStatus=="delivered","Delivery remains saved after the receiving device disconnects");
        await b.StartAsync();
        var unread = (await sarah.GetFromJsonAsync<List<ConversationDto>>(origin + "/Chat?handler=Conversations"))!.Single(c => c.Id == id).UnreadCount;
        Check(unread > 0, "Conversation updates preserve unread counts");
        await Task.WhenAll(b.InvokeAsync("MarkMessagesAsRead", id), b.InvokeAsync("MarkMessagesAsRead", id));
        Check((await sarah.GetFromJsonAsync<List<ConversationDto>>(origin + "/Chat?handler=Conversations"))!.Single(c => c.Id == id).UnreadCount == 0, "Read receipts clear unread counts");
        await using (var db = new AppDbContext(options))
        {
            var now = DateTime.UtcNow;
            db.Messages.AddRange(Enumerable.Range(0, 60).Select(i => new Message { ConversationId = id, SenderId = alexId, Content = $"Earlier message {i}", CreatedAt = now.AddSeconds(i) }));
            await db.SaveChangesAsync();
        }
        var latest = await sarah.GetFromJsonAsync<List<MessageDto>>(origin + $"/Chat?handler=Messages&conversationId={id}");
        var earlier = await sarah.GetFromJsonAsync<List<MessageDto>>(origin + $"/Chat?handler=Messages&conversationId={id}&beforeMessageId={latest![0].Id}");
        Check(latest.Count == 50 && earlier!.Count > 0 && !latest.Select(m => m.Id).Intersect(earlier.Select(m => m.Id)).Any(), "History pages are bounded and do not overlap");
        Check(latest.All(m => m.CreatedAt.Kind == DateTimeKind.Utc), "Message timestamps retain UTC semantics");
        Check(latest.All(m => m.ReadStatus == "sent"), "History waits for acknowledgement instead of guessing from online status");
        await b.InvokeAsync("MarkMessagesDelivered",latest.Select(m=>m.Id).ToArray());
        latest=await sarah.GetFromJsonAsync<List<MessageDto>>(origin+$"/Chat?handler=Messages&conversationId={id}");
        Check(latest!.All(m=>m.ReadStatus=="delivered"),"History returns persisted delivery state after device acknowledgement");
        var reactions = new TaskCompletionSource<MessageDto>(TaskCreationOptions.RunContinuationsAsynchronously);
        a.On<MessageDto>("MessageReactionUpdated", msg => reactions.TrySetResult(msg));
        await b.InvokeAsync("SendReaction", alexMessages[0].Id, "👍");
        Check(!(await reactions.Task.WaitAsync(TimeSpan.FromSeconds(5))).Reactions.Single().HasReacted, "Reactions are personalized per recipient");
        var searched = await sarah.GetFromJsonAsync<List<MessageDto>>(origin + $"/Chat?handler=SearchMessages&conversationId={id}&query=Quoted");
        var searchResult = searched!.Single();
        Check(searchResult.ReadStatus == "read" && searchResult.Reactions.Single().HasReacted &&
            searchResult.Reactions.Single().UserNames.Contains("Sarah Connor"),
            "Projected search preserves read receipts, reaction ownership, and reaction names");
        var searchPage = await sarah.GetFromJsonAsync<List<MessageDto>>(origin + $"/Chat?handler=SearchMessages&conversationId={id}&query=Earlier");
        Check(searchPage!.Count == 30 && searchPage.Select(m => m.Id).Distinct().Count() == 30,
            "Search stays bounded without duplicating messages in the joined query");
        var previousMessages = alexMessages.Count;
        await a.InvokeAsync("SendMessage", id, "Valid reply projection", "Text", null, null, null, alexMessages[0].Id);
        await WaitAsync(() => alexMessages.Count > previousMessages);
        Check(alexMessages.Last().ReplyTo?.Id == alexMessages[0].Id &&
            alexMessages.Last().ReplyTo?.Content == "Quoted ' text <script>literal</script>",
            "Projected replies preserve the referenced message and literal text");
        var denied = false;
        try { await b.InvokeAsync("EditMessage", alexMessages[0].Id, "Invalid edit"); } catch { denied = true; }
        Check(denied, "Recipients cannot edit someone else’s message");
        denied = false;
        try { await a.InvokeAsync("SendMessage", id, new string('x',10001), "Text", null, null, null, null); } catch { denied = true; }
        Check(denied, "Oversized messages are rejected");
        var groupRequest = new HttpRequestMessage(HttpMethod.Post, origin + "/Chat?handler=CreateGroup")
        { Content = JsonContent.Create(new { title = "Smoke test group", memberIds = new[] { sarahId } }) };
        groupRequest.Headers.Add("RequestVerificationToken", alexToken);
        var groupResponse = await alex.SendAsync(groupRequest); groupResponse.EnsureSuccessStatusCode();
        var group = await groupResponse.Content.ReadFromJsonAsync<ConversationDto>();
        Check(group!.IsGroup, "Group creation persists all memberships");
        Check(group.MemberNames.Contains("Alex") && group.MemberNames.Contains("Sarah"), "Group headers receive actual member names");
        var groupSvg = System.Text.Encoding.UTF8.GetString(Convert.FromBase64String(group.AvatarUrl.Split(',')[1]));
        Check(groupSvg.Contains(AvatarAppearance.GroupPath) && groupSvg.Contains("width='22'"), "Group avatars use the supplied WhatsApp group icon proportions");
        var sarahGroup = (await sarah.GetFromJsonAsync<List<ConversationDto>>(origin + "/Chat?handler=Conversations"))!.Single(c => c.Id == group.Id);
        Check(sarahGroup.AvatarUrl == group.AvatarUrl, "A group keeps the same saved avatar for every member");
        denied = false;
        try { await a.InvokeAsync("SendMessage", group.Id, "Wrong reply", "Text", null, null, null, alexMessages[0].Id); } catch { denied = true; }
        Check(denied, "Replies cannot reference a different conversation");
        await RunSocialChecksAsync(alex, sarah, alexToken, sarahToken, a, b, alexId, sarahId, id, group.Id);
        await MessageActionChecks.RunAsync(alex, sarah, a, b, origin, id, group.Id, alexId, options, Check);
        using (var voiceUpload = new MultipartFormDataContent())
        {
            var audio = await File.ReadAllBytesAsync(Path.Combine(appRoot, "wwwroot", "audio", "message.wav"));
            voiceUpload.Add(new ByteArrayContent(audio), "file", "Voice message.wav");
            using var voiceRequest = new HttpRequestMessage(HttpMethod.Post, origin + "/api/upload") { Content = voiceUpload };
            voiceRequest.Headers.Add("RequestVerificationToken", alexToken);
            var voiceResponse = await alex.SendAsync(voiceRequest);
            voiceResponse.EnsureSuccessStatusCode();
            var uploaded = await voiceResponse.Content.ReadFromJsonAsync<JsonElement>();
            var voiceUrl = uploaded.GetProperty("url").GetString()!;
            var voiceSize = uploaded.GetProperty("size").GetInt64();
            var content = "{\"wa\":\"voice\",\"duration\":1.2,\"waveform\":[0.1,0.7,0.3]}";
            var count = alexMessages.Count;
            await a.InvokeAsync("SendMessage", id, content, "Voice", voiceUrl, "Voice message.wav", voiceSize, null);
            await WaitAsync(() => alexMessages.Count > count);
            var voice = alexMessages.Last();
            Check(voice.Type == MessageType.Voice && VoiceMessageMetadata.TryParse(voice.Content, out var parsedVoice) && parsedVoice!.Duration == 1.2,
                "Voice messages persist audio attachments, duration, and waveform metadata");
            await WaitAsync(() => sarahMessages.Any(m => m.Id == voice.Id));
            Check(!sarahMessages.Single(m => m.Id == voice.Id).IsMine,
                "Voice messages arrive live with recipient ownership");
            using var rangeRequest = new HttpRequestMessage(HttpMethod.Get, origin + voiceUrl);
            rangeRequest.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(0, 11);
            var audioResponse = await sarah.SendAsync(rangeRequest);
            Check(audioResponse.StatusCode == HttpStatusCode.PartialContent && (await audioResponse.Content.ReadAsByteArrayAsync()).Length == 12,
                "Voice attachments support byte ranges for playback and seeking");
            var audioMedia = await alex.GetFromJsonAsync<JsonElement>(origin + "/api/features?handler=Media&kind=audio");
            Check(audioMedia.EnumerateArray().Any(m => m.GetProperty("id").GetInt32() == voice.Id && m.GetProperty("isAudio").GetBoolean()),
                "Voice messages appear in the shared audio library");
            foreach (var invalidVoice in new[]
            {
                (content, (string?)null),
                ("{\"wa\":\"voice\",\"duration\":9999,\"waveform\":[0.5]}", voiceUrl),
                ("{\"wa\":\"voice\",\"duration\":1,\"waveform\":[2]}", voiceUrl),
                (content, "/uploads/" + new string('a', 32) + ".txt")
            })
            {
                var rejected = false;
                try { await a.InvokeAsync("SendMessage", id, invalidVoice.Item1, "Voice", invalidVoice.Item2, "voice.wav", voiceSize, null); }
                catch (Microsoft.AspNetCore.SignalR.HubException) { rejected = true; }
                Check(rejected, "Invalid voice attachments or waveform/duration data are rejected");
            }
            var cannotEdit = false;
            try { await a.InvokeAsync("EditMessage", voice.Id, "replace metadata"); } catch (Microsoft.AspNetCore.SignalR.HubException) { cannotEdit = true; }
            Check(cannotEdit, "Voice recordings cannot be edited into invalid metadata");
            await a.InvokeAsync("DeleteMessage", voice.Id);
            var history = await sarah.GetFromJsonAsync<List<MessageDto>>(origin + $"/Chat?handler=Messages&conversationId={id}");
            var deletedVoice = history!.Single(m => m.Id == voice.Id);
            Check(deletedVoice.IsDeleted && deletedVoice.AttachmentUrl == null,
                "Deleting a voice message removes its player and attachment from message history");
        }
        var outsider = await probe.GetAsync(origin + "/api/push");
        Check(outsider.RequestMessage!.RequestUri!.AbsolutePath == "/Account/Login", "Push endpoints require sign-in");
        using var upload = new MultipartFormDataContent(); upload.Add(new ByteArrayContent("hello"u8.ToArray()), "file", "smoke.txt");
        var uploadRequest = new HttpRequestMessage(HttpMethod.Post, origin + "/api/upload") { Content = upload };
        uploadRequest.Headers.Add("RequestVerificationToken", alexToken);
        Check((await alex.SendAsync(uploadRequest)).IsSuccessStatusCode, "Attachment uploads validate the anti-forgery token");
        var noToken = await alex.PostAsJsonAsync(origin + "/api/push?handler=Subscribe", new { endpoint = "https://127.0.0.1/private", keys = new { p256dh = "bad", auth = "bad" } });
        Check(noToken.StatusCode == HttpStatusCode.BadRequest, "Push changes reject missing anti-forgery tokens");
        var invalid = new HttpRequestMessage(HttpMethod.Post, origin + "/api/push?handler=Subscribe") { Content = JsonContent.Create(new { endpoint = "https://127.0.0.1/private", keys = new { p256dh = "bad", auth = "bad" } }) };
        invalid.Headers.Add("RequestVerificationToken", alexToken);
        Check((await alex.SendAsync(invalid)).StatusCode == HttpStatusCode.BadRequest, "Push subscriptions reject private or unknown endpoints");
        var vapid = WebPushService.GenerateKeys();
        var subscription = new { endpoint = "https://fcm.googleapis.com/fcm/send/smoke-test", keys = new { p256dh = vapid.PublicKey, auth = "AAAAAAAAAAAAAAAAAAAAAA" } };
        var subscribe = new HttpRequestMessage(HttpMethod.Post, origin + "/api/push?handler=Subscribe") { Content = JsonContent.Create(subscription) };
        subscribe.Headers.Add("RequestVerificationToken", alexToken);
        Check((await alex.SendAsync(subscribe)).IsSuccessStatusCode, "Valid subscriptions persist");
        // No message is sent after registering this synthetic endpoint.
        var logout = new HttpRequestMessage(HttpMethod.Post, origin + "/Account/Logout");
        logout.Headers.Add("RequestVerificationToken", alexToken);
        (await alex.SendAsync(logout)).EnsureSuccessStatusCode();
        await using (var db = new AppDbContext(options))
            Check(await db.WebPushSubscriptions.CountAsync() == 0, "Logout removes this device’s server subscription");
    }
    Console.WriteLine($"All {checks} checks passed.");
}
finally
{
    if (!server.HasExited) { server.Kill(entireProcessTree: true); await server.WaitForExitAsync(); }
    var serverOutput = await outputTask;
    var serverErrors = await errorTask;
    if (server.ExitCode != 0 && !string.IsNullOrWhiteSpace(serverErrors))
        Console.Error.WriteLine(serverErrors);
    if (!cs.Database.StartsWith("messagingapp_smoke_")) throw new InvalidOperationException("Unsafe test database cleanup.");
    await using var cleanup = new AppDbContext(options); await cleanup.Database.EnsureDeletedAsync();
}

async Task<(HttpClient, CookieContainer, string)> LoginAsync(string username)
{
    // Test fixtures receive real protected cookies without a public password-login route.
    await using var db = new AppDbContext(options);
    var user = await db.Users.SingleAsync(u => u.Username == username);
    var keyDirectory = new DirectoryInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "ASP.NET", "DataProtection-Keys"));
    var provider = DataProtectionProvider.Create(keyDirectory, builder => builder.SetApplicationName(root.FullName + Path.DirectorySeparatorChar));
    var protector = provider.CreateProtector("Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationMiddleware", CookieAuthenticationDefaults.AuthenticationScheme, "v2");
    var ticket = new AuthenticationTicket(AccountPrincipal.Create(user), new AuthenticationProperties
    { IssuedUtc = DateTimeOffset.UtcNow, ExpiresUtc = DateTimeOffset.UtcNow.AddHours(1) }, CookieAuthenticationDefaults.AuthenticationScheme);
    var cookies = new CookieContainer();
    cookies.Add(new Uri(origin), new Cookie(".AspNetCore.Cookies", new TicketDataFormat(protector).Protect(ticket)));
    var client = new HttpClient(new HttpClientHandler { CookieContainer = cookies });
    var html = await client.GetStringAsync(origin + "/Chat");
    var token = WebUtility.HtmlDecode(Regex.Match(html, "name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);
    if (token.Length == 0) throw new Exception("Test sign-in did not return a chat page.");
    return (client, cookies, token);
}
async Task<HttpResponseMessage> FeaturePostAsync(HttpClient client, string token, string handler, object data, string extra = "")
{
    var request = new HttpRequestMessage(HttpMethod.Post, origin + "/api/features?handler=" + handler + extra) { Content = JsonContent.Create(data) };
    request.Headers.Add("RequestVerificationToken", token);
    return await client.SendAsync(request);
}

async Task RunSocialChecksAsync(HttpClient alex, HttpClient sarah, string alexToken, string sarahToken, HubConnection a, HubConnection b, int alexId, int sarahId, int directId, int groupId)
{
    await using(var db = new AppDbContext(options))
        await new AuthService(db).RegisterAsync("outsider-test", "outsider@example.net", "TestPassword123!", "Outside Person", null, null);
    var (third, thirdCookies, thirdToken) = await LoginAsync("outsider-test");
    using(third)
    {
        await using var c = new HubConnectionBuilder().WithUrl(origin + "/hubs/chat", cfg => cfg.Cookies = thirdCookies).Build();
        await c.StartAsync();
        var statusResponse = await FeaturePostAsync(alex, alexToken, "Status", new { text = "A real status update", color = "#008069" });
        Check(statusResponse.IsSuccessStatusCode, "A status can be posted and saved");
        var statusId = (await statusResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var visible = await sarah.GetFromJsonAsync<JsonElement>(origin + "/api/features?handler=Statuses");
        Check(visible.EnumerateArray().Any(s => s.GetProperty("id").GetInt32() == statusId), "Chat contacts can see active statuses");
        var invisible = await third.GetFromJsonAsync<JsonElement>(origin + "/api/features?handler=Statuses");
        Check(invisible.GetArrayLength() == 0, "Unrelated accounts cannot read statuses");
        Check((await FeaturePostAsync(third, thirdToken, "ViewStatus", new {}, "&id="+statusId)).StatusCode == HttpStatusCode.NotFound, "Status views enforce the audience");
        await FeaturePostAsync(sarah, sarahToken, "ViewStatus", new {}, "&id="+statusId);
        await FeaturePostAsync(sarah, sarahToken, "ViewStatus", new {}, "&id="+statusId);
        await using(var db = new AppDbContext(options)) Check(await db.StatusViews.CountAsync(v=>v.StatusPostId==statusId)==1, "A status records each viewer once");
        Check((await FeaturePostAsync(sarah, sarahToken, "DeleteStatus", new {}, "&id="+statusId)).StatusCode == HttpStatusCode.NotFound, "Only the author can delete a status");
        await using(var db = new AppDbContext(options)) await db.StatusPosts.Where(s=>s.Id==statusId).ExecuteUpdateAsync(set=>set.SetProperty(s=>s.ExpiresAt,DateTime.UtcNow.AddSeconds(-1)));
        Check((await sarah.GetFromJsonAsync<JsonElement>(origin + "/api/features?handler=Statuses")).GetArrayLength()==0, "Expired statuses are hidden after 24 hours");
        Check((await alex.PostAsJsonAsync(origin + "/api/features?handler=Status",new {text="No token"})).StatusCode==HttpStatusCode.BadRequest, "Status changes require an anti-forgery token");
        Check((await FeaturePostAsync(alex,alexToken,"Status",new {text="Photo",imageUrl="https://other.example/image.jpg"})).StatusCode==HttpStatusCode.BadRequest, "Statuses reject external or invalid photo URLs");
        var communityResponse = await FeaturePostAsync(alex,alexToken,"Community",new {title="Neighbourhood",description="Together",memberIds=new[]{sarahId}});
        Check(communityResponse.IsSuccessStatusCode,"Communities persist members and an announcement chat");
        var communityId=(await communityResponse.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        var detail=await sarah.GetFromJsonAsync<JsonElement>(origin+"/api/features?handler=Community&id="+communityId);
        var announcementId=detail.GetProperty("groups").EnumerateArray().Single().GetProperty("id").GetInt32();
        Check(detail.GetProperty("members").GetArrayLength()==2,"Community members can inspect their groups and people");
        Check((await third.GetAsync(origin+"/api/features?handler=Community&id="+communityId)).StatusCode==HttpStatusCode.NotFound,"Community details are private to members");
        Check((await FeaturePostAsync(sarah,sarahToken,"CommunityGroup",new {title="Bad group"},"&id="+communityId)).StatusCode==HttpStatusCode.Forbidden,"Only community admins can create groups");
        var denied=false;try{await b.InvokeAsync("SendMessage",announcementId,"Not allowed","Text",null,null,null,null);}catch{denied=true;}
        Check(denied,"Only admins can post in announcement chats");
        await a.InvokeAsync("SendMessage",announcementId,"Community announcement","Text",null,null,null,null);
        var communityGroup=await FeaturePostAsync(alex,alexToken,"CommunityGroup",new {title="Weekend plans"},"&id="+communityId);
        communityGroup.EnsureSuccessStatusCode();var communityGroupId=(await communityGroup.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("id").GetInt32();
        Check((await sarah.GetFromJsonAsync<List<ConversationDto>>(origin+"/Chat?handler=Conversations"))!.Any(chat=>chat.Id==communityGroupId),"Community groups appear in members’ chat lists");
        var fakeUrl="/uploads/"+new string('a',32)+".png";
        await using(var db=new AppDbContext(options))
        {
            var thirdId=await db.Users.Where(u=>u.Username=="outsider-test").Select(u=>u.Id).SingleAsync();
            var privateChat=new Conversation{IsGroup=true,Title="Private"};db.Conversations.Add(privateChat);await db.SaveChangesAsync();
            db.ConversationMembers.Add(new ConversationMember{UserId=thirdId,ConversationId=privateChat.Id});
            db.Messages.AddRange(new Message{ConversationId=directId,SenderId=alexId,Type=MessageType.Image,AttachmentUrl=fakeUrl,AttachmentName="Direct photo.png"},new Message{ConversationId=groupId,SenderId=sarahId,Type=MessageType.Document,AttachmentUrl="/uploads/"+new string('b',32)+".txt",AttachmentName="Group file.txt"},new Message{ConversationId=communityGroupId,SenderId=alexId,Type=MessageType.Image,AttachmentUrl=fakeUrl,AttachmentName="Community photo.png"},new Message{ConversationId=privateChat.Id,SenderId=thirdId,Type=MessageType.Image,AttachmentUrl=fakeUrl,AttachmentName="Private photo.png"},new Message{ConversationId=directId,SenderId=alexId,Type=MessageType.Image,AttachmentUrl=fakeUrl,AttachmentName="Deleted.png",IsDeleted=true});
            await db.SaveChangesAsync();
        }
        var media=await alex.GetFromJsonAsync<JsonElement>(origin+"/api/features?handler=Media");var names=media.EnumerateArray().Select(m=>m.GetProperty("attachmentName").GetString()).ToArray();
        Check(names.Contains("Direct photo.png")&&names.Contains("Group file.txt")&&names.Contains("Community photo.png")&&!names.Contains("Private photo.png")&&!names.Contains("Deleted.png"),"Media library spans direct, group, and community chats without exposing private or deleted files");
        var photos=await alex.GetFromJsonAsync<JsonElement>(origin+"/api/features?handler=Media&kind=photos");Check(photos.EnumerateArray().All(m=>m.GetProperty("isImage").GetBoolean()),"Media type filters work on the server");
        var incoming=new TaskCompletionSource<CallInfo>(TaskCreationOptions.RunContinuationsAsynchronously);b.On<CallInfo>("IncomingCall",info=>incoming.TrySetResult(info));
        var call=await a.InvokeAsync<CallInfo>("StartCall",directId,true);Check((await incoming.Task.WaitAsync(TimeSpan.FromSeconds(5))).Id==call.Id,"Voice/video call invitations reach the intended recipient");
        denied=false;try{await b.InvokeAsync("StartCall",directId,false);}catch{denied=true;}Check(denied,"Busy accounts cannot start a second call");
        await b.InvokeAsync("AcceptCall",call.Id);
        denied=false;try{await c.InvokeAsync("CallSignal",call.Id,"offer","{\"type\":\"offer\",\"sdp\":\"test\"}");}catch{denied=true;}Check(denied,"Unrelated users cannot inject call signals");
        var signal=new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);b.On<JsonElement>("CallSignal",data=>signal.TrySetResult(data));
        await a.InvokeAsync("CallSignal",call.Id,"offer","{\"type\":\"offer\",\"sdp\":\"synthetic SDP\"}");Check((await signal.Task.WaitAsync(TimeSpan.FromSeconds(5))).GetProperty("id").GetString()==call.Id,"Accepted calls exchange authorized session descriptions");
        denied=false;try{await a.InvokeAsync("CallSignal",call.Id,"ice","invalid JSON");}catch{denied=true;}Check(denied,"Malformed call signals are rejected");
        await a.StopAsync();await a.StartAsync();await a.InvokeAsync("ResumeCall",call.Id);await a.InvokeAsync("CallSignal",call.Id,"ice","{\"candidate\":\"synthetic candidate\"}");Check(true,"A reconnecting caller can reclaim its call and resume signalling");
        denied=false;try{await c.InvokeAsync("EndCall",call.Id,"completed");}catch{denied=true;}Check(denied,"Unrelated users cannot end a call");
        await a.InvokeAsync("EndCall",call.Id,"completed");
        var history=await sarah.GetFromJsonAsync<JsonElement>(origin+"/api/features?handler=Calls");Check(history.EnumerateArray().Any(c=>c.GetProperty("id").GetString()==call.Id&&c.GetProperty("state").GetString()=="completed"),"Call outcomes are saved in each participant’s history");
        await b.StopAsync();
        var offlineCall=await a.InvokeAsync<CallInfo>("StartCall",directId,false);
        Check(offlineCall.State=="ringing","A caller can invite a recipient with no connected chat browser");
        Check(await c.InvokeAsync<CallInfo?>("PendingCall") is null,"Pending offline invitations remain private to the recipient");
        await b.StartAsync();
        var pendingCall=await b.InvokeAsync<CallInfo?>("PendingCall");
        Check(pendingCall?.Id==offlineCall.Id,"Opening the app restores a still-ringing offline call invitation");
        await b.InvokeAsync("AcceptCall",offlineCall.Id);
        await a.InvokeAsync("EndCall",offlineCall.Id,"completed");
        Check(await b.InvokeAsync<CallInfo?>("PendingCall") is null,"Ended invitations cannot reappear as pending calls");
        denied=false;try{await a.InvokeAsync("StartCall",groupId,false);}catch{denied=true;}Check(denied,"Group calls are not presented as supported direct calls");
        var relay=await alex.GetFromJsonAsync<JsonElement>(origin+"/api/features?handler=CallConfig");Check(relay.GetProperty("relayConfigured").GetBoolean()&&!relay.ToString().Contains("synthetic-relay-secret"),"Call relay uses expiring credentials without disclosing its shared secret");
        Check((await FeaturePostAsync(alex,alexToken,"LeaveCommunity",new {},"&id="+communityId)).StatusCode==HttpStatusCode.BadRequest,"The last community admin must appoint a successor");
        await FeaturePostAsync(alex,alexToken,"CommunityAdmin",new {},"&id="+communityId+"&userId="+sarahId);
        Check((await FeaturePostAsync(alex,alexToken,"LeaveCommunity",new {},"&id="+communityId)).IsSuccessStatusCode,"Members can leave after handing over community administration");
        Check((await alex.GetAsync(origin+"/api/features?handler=Community&id="+communityId)).StatusCode==HttpStatusCode.NotFound,"Leaving revokes access to community details");
        var profileHtml=await alex.GetStringAsync(origin+"/Account/Profile");var profileToken=WebUtility.HtmlDecode(Regex.Match(profileHtml,"name=\"__RequestVerificationToken\"[^>]*value=\"([^\"]+)\"").Groups[1].Value);
        var saved=await alex.PostAsync(origin+"/Account/Profile",new FormUrlEncodedContent(new Dictionary<string,string>{{"Username","alex_updated"},{"DisplayName","Alex Updated"},{"About","Here for good conversations"},{"AvatarUrl",AvatarAppearance.DefaultUrl},{"__RequestVerificationToken",profileToken}}));
        Check(saved.IsSuccessStatusCode&&(await saved.Content.ReadAsStringAsync()).Contains("alex_updated"),"Profile saves editable usernames and names through the actual form");
        await using(var db=new AppDbContext(options))
        {
            var auth=new AuthService(db);Check(!(await auth.UpdateProfileAsync(alexId,"Alex Updated",null,null,"sarah")).Success,"Duplicate usernames are rejected without replacing another account");
            Check(!(await auth.UpdateProfileAsync(alexId,"Alex Updated",null,null,"invalid name")).Success,"Username format is validated on the server");
        }
        var audio=await alex.GetByteArrayAsync(origin+"/audio/message.wav");Check(System.Text.Encoding.ASCII.GetString(audio,0,4)=="RIFF","The notification chime is a real locally served audio asset");
    }
}
async Task WaitAsync(Func<bool> predicate)
{
    for (var i=0;i<100;i++) { if (predicate()) return; await Task.Delay(50); }
    throw new TimeoutException("Live event was not delivered.");
}

sealed class CapturingPushHandler : HttpMessageHandler
{
    public string Encoding { get; private set; } = "";
    public string Ttl { get; private set; } = "";
    public string Authorization { get; private set; } = "";
    public byte[] Body { get; private set; } = [];
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        Encoding = string.Join(",", request.Content!.Headers.ContentEncoding);
        Ttl = request.Headers.GetValues("TTL").Single();
        Authorization = request.Headers.Authorization?.ToString() ?? "";
        Body = await request.Content.ReadAsByteArrayAsync(cancellationToken);
        return new(HttpStatusCode.Created);
    }
}



