using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc.RazorPages;

namespace MessagingApp.Pages.Communities;

[Authorize]
public class CreateModel : PageModel
{
    public void OnGet() { }
}
