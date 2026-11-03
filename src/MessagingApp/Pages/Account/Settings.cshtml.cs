using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using MessagingApp.Models;
using MessagingApp.Services;

namespace MessagingApp.Pages.Account;

[Authorize]
public class SettingsModel(IAuthService authService) : PageModel
{
    public User CurrentUser { get; private set; } = null!;
    public string AvatarUrl { get; private set; } = AvatarAppearance.DefaultUrl;
    public string AboutText { get; private set; } = "";
    public string ContactLink { get; private set; } = "";

    int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public async Task<IActionResult> OnGetAsync()
    {
        var user = await authService.GetUserByIdAsync(UserId);
        if (user == null) return RedirectToPage("/Account/Login");
        CurrentUser = user;
        AvatarUrl = AvatarAppearance.ForUser(user);
        AboutText = string.IsNullOrWhiteSpace(user.About) ? "Hey there! I am using WhatsApp." : user.About;
        ContactLink = ContactCodes.Link(Request, user.Username);
        return Page();
    }
}
