using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;
using System.Security.Claims;

namespace MessagingApp.Pages.Account;

public class LogoutModel(AppDbContext db) : PageModel
{
    private async Task RemovePushDeviceAsync()
    {
        if (int.TryParse(User.FindFirstValue(ClaimTypes.NameIdentifier), out var userId) &&
            Request.Cookies.TryGetValue("wa_push_device", out var hash))
            await db.WebPushSubscriptions.Where(s => s.UserId == userId && s.EndpointHash == hash).ExecuteDeleteAsync();
        Response.Cookies.Delete("wa_push_device");
    }
    public IActionResult OnGet() => Page();

    public async Task<IActionResult> OnPostAsync()
    {
        await RemovePushDeviceAsync();
        await HttpContext.SignOutAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        return RedirectToPage("/Account/Login");
    }
}
