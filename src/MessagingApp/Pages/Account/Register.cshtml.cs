using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
namespace MessagingApp.Pages.Account;
public class RegisterModel : PageModel
{
    public IActionResult OnGet() => RedirectToPage("/Account/Login");
    public IActionResult OnPost() => RedirectToPage("/Account/Login");
}
