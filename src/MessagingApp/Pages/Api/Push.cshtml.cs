using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;
using MessagingApp.Models;
using MessagingApp.Services;

namespace MessagingApp.Pages.Api;

[Authorize]
[ResponseCache(NoStore = true, Location = ResponseCacheLocation.None)]
public class PushModel(AppDbContext db, WebPushService push) : PageModel
{
    private int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    public IActionResult OnGet() => new JsonResult(new { enabled = push.Enabled, publicKey = push.PublicKey });
    public sealed class SubscriptionInput
    {
        public string Endpoint { get; set; } = "";
        public Dictionary<string, string> Keys { get; set; } = new();
    }

    public async Task<IActionResult> OnPostSubscribeAsync([FromBody] SubscriptionInput input)
    {
        if (!push.Enabled) return StatusCode(503, new { error = "Notifications are not configured on this server yet." });
        if (input == null || !WebPushService.IsValidEndpoint(input.Endpoint) || input.Keys == null ||
            !input.Keys.TryGetValue("p256dh", out var key) || !input.Keys.TryGetValue("auth", out var auth) ||
            !WebPushService.IsValidKey(key, 65) || !WebPushService.IsValidKey(auth, 16))
            return BadRequest(new { error = "Invalid push subscription." });
        var hash = WebPushService.HashEndpoint(input.Endpoint);
        var subscription = await db.WebPushSubscriptions.FirstOrDefaultAsync(s => s.EndpointHash == hash);
        if (subscription == null)
        {
            if (await db.WebPushSubscriptions.CountAsync(s => s.UserId == UserId) >= 20)
                return BadRequest(new { error = "Device limit reached. Disable notifications on an unused device." });
            subscription = new WebPushSubscription { EndpointHash = hash };
            db.WebPushSubscriptions.Add(subscription);
        }
        // A browser's subscription belongs to its currently signed-in account.
        subscription.UserId = UserId;
        subscription.Endpoint = input.Endpoint;
        subscription.P256dh = key;
        subscription.Auth = auth;
        subscription.UpdatedAt = DateTime.UtcNow;
        try { await db.SaveChangesAsync(); }
        catch (DbUpdateException ex) when (ex.InnerException is MySql.Data.MySqlClient.MySqlException { Number: 1062 })
        {
            // Two tabs can synchronize the same browser subscription at once.
            db.Entry(subscription).State = EntityState.Detached;
            await db.WebPushSubscriptions.Where(s => s.EndpointHash == hash).ExecuteUpdateAsync(setters => setters
                .SetProperty(s => s.UserId, UserId).SetProperty(s => s.Endpoint, input.Endpoint)
                .SetProperty(s => s.P256dh, key).SetProperty(s => s.Auth, auth).SetProperty(s => s.UpdatedAt, DateTime.UtcNow));
        }
        Response.Cookies.Append("wa_push_device", hash, new CookieOptions
        { HttpOnly = true, Secure = Request.IsHttps, SameSite = SameSiteMode.Strict, MaxAge = TimeSpan.FromDays(365) });
        return new JsonResult(new { success = true });
    }

    public async Task<IActionResult> OnPostUnsubscribeAsync([FromBody] SubscriptionInput input)
    {
        if (string.IsNullOrEmpty(input?.Endpoint)) return BadRequest();
        var hash = WebPushService.HashEndpoint(input.Endpoint);
        await db.WebPushSubscriptions.Where(s => s.UserId == UserId && s.EndpointHash == hash).ExecuteDeleteAsync();
        Response.Cookies.Delete("wa_push_device");
        return new JsonResult(new { success = true });
    }
}
