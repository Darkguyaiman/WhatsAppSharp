using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace MessagingApp.Pages.Status;

[Authorize]
public class ComposeModel : PageModel
{
    public void OnGet() { }
}
