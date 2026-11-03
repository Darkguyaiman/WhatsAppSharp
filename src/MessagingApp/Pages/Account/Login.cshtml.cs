using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace MessagingApp.Pages.Account;

public class LoginModel(IAuthenticationSchemeProvider schemes) : PageModel
{
    [BindProperty]
    public bool RememberMe { get; set; } = true;
    public string? ErrorMessage { get; set; }
    public string ReturnUrl { get; private set; } = "/Chat";
    private void Prepare(string? returnUrl) => ReturnUrl = !string.IsNullOrEmpty(returnUrl) && Url.IsLocalUrl(returnUrl) ? returnUrl : "/Chat";
    public IActionResult OnGet(string? returnUrl = null, string? error = null)
    {
        Prepare(returnUrl);
        if (User.Identity?.IsAuthenticated == true) return LocalRedirect(ReturnUrl);
        if (error == "google") ErrorMessage = "Google sign-in could not be completed. Please try again or choose a different Google account.";
        return Page();
    }
    public async Task<IActionResult> OnPostGoogleAsync(string? returnUrl = null)
    {
        Prepare(returnUrl);
        if (await schemes.GetSchemeAsync(GoogleDefaults.AuthenticationScheme) == null)
        {
            ErrorMessage = "Google sign-in is not available yet. Please try again later.";
            return Page();
        }
        return Challenge(new AuthenticationProperties
        {
            RedirectUri = ReturnUrl, IsPersistent = RememberMe,
            ExpiresUtc = DateTimeOffset.UtcNow.AddDays(30)
        }, GoogleDefaults.AuthenticationScheme);
    }
}
