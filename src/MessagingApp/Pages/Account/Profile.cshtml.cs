using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Cookies;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using MessagingApp.Services;
using MessagingApp.Models;

namespace MessagingApp.Pages.Account;

[Authorize]
public class ProfileModel(IAuthService authService) : PageModel
{
    [BindProperty, Required, MaxLength(100)] public string DisplayName { get; set; } = "";
    [BindProperty, Required, RegularExpression(@"^[a-zA-Z0-9_.]{3,50}$", ErrorMessage = "Use 3–50 letters, numbers, dots, or underscores.")] public string Username { get; set; } = "";
    [BindProperty, MaxLength(255)] public string? About { get; set; }
    [BindProperty] public string AvatarUrl { get; set; } = AvatarAppearance.DefaultUrl;
    public string Email { get; set; } = "";
    public string AvatarPreviewUrl { get; set; } = "";
    public string InitialsAvatarUrl { get; set; } = "";
    [TempData] public string? SuccessMessage { get; set; }
    public string? ErrorMessage { get; set; }
    int UserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    void Preview(User user)
    {
        Email = user.Email;
        InitialsAvatarUrl = AvatarAppearance.ForInitials(DisplayName, user.AvatarColor);
        AvatarPreviewUrl = AvatarAppearance.IsDefault(AvatarUrl) ? InitialsAvatarUrl : AvatarUrl;
    }
    public async Task<IActionResult> OnGetAsync()
    {
        var user = await authService.GetUserByIdAsync(UserId);
        if (user == null) return RedirectToPage("/Account/Login");
        DisplayName = user.DisplayName; Username = user.Username; About = user.About; AvatarUrl = user.AvatarUrl ?? AvatarAppearance.DefaultUrl;
        Preview(user); return Page();
    }
    public async Task<IActionResult> OnPostAsync()
    {
        var user = await authService.GetUserByIdAsync(UserId);
        if (user == null) return RedirectToPage("/Account/Login");
        Preview(user);
        if (!ModelState.IsValid) return Page();
        var (success, error) = await authService.UpdateProfileAsync(UserId, DisplayName, About, AvatarUrl, Username);
        if (!success) { ErrorMessage = error; return Page(); }
        var ticket = await HttpContext.AuthenticateAsync(CookieAuthenticationDefaults.AuthenticationScheme);
        await HttpContext.SignInAsync(CookieAuthenticationDefaults.AuthenticationScheme, AccountPrincipal.Create(user), ticket.Properties ?? new AuthenticationProperties());
        SuccessMessage = "Your profile is saved.";
        return RedirectToPage();
    }
}
