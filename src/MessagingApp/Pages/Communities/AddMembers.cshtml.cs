using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;

namespace MessagingApp.Pages.Communities;

[Authorize]
public class AddMembersModel(AppDbContext db) : PageModel
{
    public int CommunityId { get; private set; }
    public string CommunityTitle { get; private set; } = "";

    int Me => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);

    public async Task<IActionResult> OnGetAsync(int id)
    {
        var community = await db.Communities.AsNoTracking()
            .Where(c => c.Id == id && c.Members.Any(m => m.UserId == Me && m.IsAdmin))
            .Select(c => new { c.Id, c.Title })
            .FirstOrDefaultAsync();
        if (community == null) return RedirectToPage("/Chat/Index", new { feature = "communities" });
        CommunityId = community.Id;
        CommunityTitle = community.Title;
        return Page();
    }
}
