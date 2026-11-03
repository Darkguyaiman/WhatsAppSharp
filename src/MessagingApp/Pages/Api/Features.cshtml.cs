using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;
using MessagingApp.Hubs;
using MessagingApp.Models;
using MessagingApp.Services;

namespace MessagingApp.Pages.Api;

[Authorize]
public class FeaturesModel(AppDbContext db, IHubContext<ChatHub> hub, IUserPresenceService presence, IConfiguration config, IWebHostEnvironment environment) : PageModel
{
    int Me => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    static DateTime Utc(DateTime date) => DateTime.SpecifyKind(date, DateTimeKind.Utc);
    static readonly string[] StatusColors = ["#008069", "#5151a8", "#8b4057", "#305f7b", "#42594b"];
    IQueryable<StatusPost> VisibleStatuses() => db.StatusPosts.Where(s => s.ExpiresAt > DateTime.UtcNow &&
        (s.UserId == Me || db.ConversationMembers.Any(their => their.UserId == s.UserId && db.ConversationMembers.Any(mine => mine.UserId == Me && mine.ConversationId == their.ConversationId)) ||
         db.CommunityMembers.Any(their => their.UserId == s.UserId && db.CommunityMembers.Any(mine => mine.UserId == Me && mine.CommunityId == their.CommunityId))));

    public async Task<IActionResult> OnGetStatusesAsync()
    {
        var rows = await VisibleStatuses().AsNoTracking().Include(s => s.User).Include(s => s.Views).OrderByDescending(s => s.CreatedAt).Take(100).ToListAsync();
        return new JsonResult(rows.Select(s => new { s.Id, s.UserId, s.Text, s.ImageUrl, s.Color, style = StatusStyle.Parse(s.Style), createdAt = Utc(s.CreatedAt), expiresAt = Utc(s.ExpiresAt),
            name = s.User.DisplayName, avatar = AvatarAppearance.ForUser(s.User), isMine = s.UserId == Me, viewed = s.Views.Any(v => v.UserId == Me),
            views = s.UserId == Me ? s.Views.Count : (int?)null }));
    }
    public record StatusStyleInput(int? ImageScale, string? Align, string? Size, bool Bold = false, bool Italic = false);
    public record StatusInput(string? Text, string? ImageUrl, string? Color, StatusStyleInput? Style);
    public async Task<IActionResult> OnPostStatusAsync([FromBody] StatusInput input)
    {
        if (input == null || input.Text?.Length > 700 || (string.IsNullOrWhiteSpace(input.Text) && string.IsNullOrEmpty(input.ImageUrl))) return BadRequest(new { error = "Write an update or choose a photo." });
        if (input.ImageUrl != null && (!Regex.IsMatch(input.ImageUrl, @"^/uploads/[a-f0-9]{32}\.(jpg|jpeg|png|gif|webp)$") || !System.IO.File.Exists(Path.Combine(environment.WebRootPath, input.ImageUrl.TrimStart('/')))))
            return BadRequest(new { error = "Choose a photo uploaded to this app." });
        if (await db.StatusPosts.CountAsync(s => s.UserId == Me && s.CreatedAt > DateTime.UtcNow.AddDays(-1)) >= 20) return BadRequest(new { error = "You can post up to 20 updates per day." });
        var styleJson = input.Style == null ? null : System.Text.Json.JsonSerializer.Serialize(new
        {
            imageScale = input.Style.ImageScale,
            align = input.Style.Align,
            size = input.Style.Size,
            bold = input.Style.Bold,
            italic = input.Style.Italic
        });
        var status = new StatusPost
        {
            UserId = Me,
            Text = input.Text?.Trim() ?? "",
            ImageUrl = input.ImageUrl,
            Color = StatusColors.Contains(input.Color) ? input.Color! : StatusColors[0],
            Style = StatusStyle.Normalize(styleJson)
        };
        db.StatusPosts.Add(status); await db.SaveChangesAsync();
        await NotifyStatusAsync();
        return new JsonResult(new { status.Id });
    }
    public async Task<IActionResult> OnPostViewStatusAsync(int id)
    {
        if (!await VisibleStatuses().AnyAsync(s => s.Id == id)) return NotFound();
        if (!await db.StatusPosts.AnyAsync(s => s.Id == id && s.UserId == Me) && !await db.StatusViews.AnyAsync(v => v.StatusPostId == id && v.UserId == Me))
        {
            db.StatusViews.Add(new StatusView { StatusPostId = id, UserId = Me });
            try { await db.SaveChangesAsync(); } catch (DbUpdateException) { /* Concurrent view from another tab. */ }
        }
        return new JsonResult(new { success = true });
    }
    public async Task<IActionResult> OnPostDeleteStatusAsync(int id)
    {
        if (await db.StatusPosts.Where(s => s.Id == id && s.UserId == Me).ExecuteDeleteAsync() == 0) return NotFound();
        await NotifyStatusAsync(); return new JsonResult(new { success = true });
    }
    async Task NotifyStatusAsync()
    {
        var contacts = await db.ConversationMembers.Where(m => db.ConversationMembers.Any(own => own.UserId == Me && own.ConversationId == m.ConversationId)).Select(m => m.UserId).ToListAsync();
        contacts.AddRange(await db.CommunityMembers.Where(m => db.CommunityMembers.Any(own => own.UserId == Me && own.CommunityId == m.CommunityId)).Select(m => m.UserId).ToListAsync());
        contacts.Add(Me);
        await hub.Clients.Users(contacts.Distinct().Select(id => id.ToString()).ToArray()).SendAsync("StatusesChanged");
    }
    public async Task<IActionResult> OnGetMediaAsync(int? before = null, string? kind = null, string? query = null)
    {
        var media = db.Messages.AsNoTracking().Where(m => !m.IsDeleted && !m.UserStates.Any(s => s.UserId == Me && s.IsHidden) && m.AttachmentUrl != null && db.ConversationMembers.Any(cm => cm.UserId == Me && cm.ConversationId == m.ConversationId));
        if (before.HasValue) media = media.Where(m => m.Id < before);
        if (!string.IsNullOrWhiteSpace(query)) { var term = query.Trim()[..Math.Min(query.Trim().Length, 100)]; media = media.Where(m => m.AttachmentName!.Contains(term) || m.Conversation.Title!.Contains(term)); }
        if (kind == "photos") media = media.Where(m => m.Type == MessageType.Image);
        if (kind == "videos") media = media.Where(m => m.Type != MessageType.Voice && m.AttachmentUrl!.EndsWith(".mp4"));
        if (kind == "audio") media = media.Where(m => m.Type == MessageType.Voice || m.AttachmentUrl!.EndsWith(".mp3") || m.AttachmentUrl.EndsWith(".ogg") || m.AttachmentUrl.EndsWith(".m4a") || m.AttachmentUrl.EndsWith(".wav"));
        if (kind == "documents") media = media.Where(m => m.Type != MessageType.Image && m.Type != MessageType.Voice && !m.AttachmentUrl!.EndsWith(".mp4") && !m.AttachmentUrl.EndsWith(".mp3") && !m.AttachmentUrl.EndsWith(".ogg") && !m.AttachmentUrl.EndsWith(".m4a") && !m.AttachmentUrl.EndsWith(".wav"));
        var rows = await media.Include(m => m.Sender).Include(m => m.Conversation).OrderByDescending(m => m.Id).Take(40).ToListAsync();
        return new JsonResult(rows.Select(m => new { m.Id, m.ConversationId, m.AttachmentUrl, m.AttachmentName, m.AttachmentSize, isImage = m.Type == MessageType.Image,
            isAudio = m.Type == MessageType.Voice || new[] { ".mp3", ".ogg", ".m4a", ".wav" }.Contains(Path.GetExtension(m.AttachmentUrl)),
            sender = m.Sender.DisplayName, conversation = m.Conversation.Title ?? "Direct chat", createdAt = Utc(m.CreatedAt) }));
    }
    public async Task<IActionResult> OnGetCommunitiesAsync()
    {
        var communities = await db.Communities.AsNoTracking().Include(c => c.Members).Where(c => c.Members.Any(m => m.UserId == Me)).OrderBy(c => c.Title).ToListAsync();
        return new JsonResult(communities.Select(c => new { c.Id, c.Title, c.Description, members = c.Members.Count, isAdmin = c.Members.Any(m => m.UserId == Me && m.IsAdmin) }));
    }
    public async Task<IActionResult> OnGetCommunityAsync(int id)
    {
        var community = await db.Communities.AsNoTracking().Include(c => c.Members).ThenInclude(m => m.User).FirstOrDefaultAsync(c => c.Id == id && c.Members.Any(m => m.UserId == Me));
        if (community == null) return NotFound();
        var groups = await db.Conversations.AsNoTracking().Where(c => c.CommunityId == id && c.Members.Any(m => m.UserId == Me)).Select(c => new { c.Id, c.Title, c.IsAnnouncement }).ToListAsync();
        return new JsonResult(new { community.Id, community.Title, community.Description, isAdmin = community.Members.Any(m => m.UserId == Me && m.IsAdmin), groups,
            members = community.Members.Select(m => new { m.UserId, name = m.User.DisplayName, m.IsAdmin, avatar = AvatarAppearance.ForUser(m.User) }) });
    }
    public record CommunityInput(string? Title, string? Description, List<int>? MemberIds);
    public async Task<IActionResult> OnPostCommunityAsync([FromBody] CommunityInput input)
    {
        if (input == null || string.IsNullOrWhiteSpace(input.Title) || input.Title.Trim().Length > 100 || input.Description?.Length > 500 || input.MemberIds?.Count > 100) return BadRequest(new { error = "Add a community name (up to 100 characters) and a short description." });
        var ids = (input.MemberIds ?? []).Append(Me).Distinct().ToList();
        if (await db.Users.CountAsync(u => ids.Contains(u.Id)) != ids.Count) return BadRequest(new { error = "A selected person is no longer available." });
        await using var transaction = await db.Database.BeginTransactionAsync();
        var community = new Models.Community { Title = input.Title.Trim(), Description = input.Description?.Trim() ?? "" };
        db.Communities.Add(community); await db.SaveChangesAsync();
        db.CommunityMembers.AddRange(ids.Select(id => new CommunityMember { CommunityId = community.Id, UserId = id, IsAdmin = id == Me }));
        var announcements = new Conversation { Title = community.Title + " · Announcements", CommunityId = community.Id, IsGroup = true, IsAnnouncement = true };
        if (announcements.Title.Length > 100) announcements.Title = announcements.Title[..100];
        db.Conversations.Add(announcements); await db.SaveChangesAsync();
        db.ConversationMembers.AddRange(ids.Select(id => new ConversationMember { ConversationId = announcements.Id, UserId = id, IsAdmin = id == Me }));
        await db.SaveChangesAsync(); await transaction.CommitAsync();
        await NotifyCommunityAsync(community.Id, ids, announcements.Id);
        return new JsonResult(new { community.Id });
    }
    public async Task<IActionResult> OnPostCommunityGroupAsync(int id, [FromBody] CommunityInput input)
    {
        if (!await db.CommunityMembers.AnyAsync(m => m.CommunityId == id && m.UserId == Me && m.IsAdmin)) return StatusCode(403, new { error = "Only community admins can do that." });
        if (input == null || string.IsNullOrWhiteSpace(input.Title) || input.Title.Length > 100) return BadRequest(new { error = "Enter a group name (up to 100 characters)." });
        await using var transaction = await db.Database.BeginTransactionAsync();
        var ids = await db.CommunityMembers.Where(m => m.CommunityId == id).Select(m => m.UserId).ToListAsync();
        if (await db.Conversations.CountAsync(c => c.CommunityId == id) >= 25) return BadRequest(new { error = "This community already has 25 groups." });
        var group = new Conversation { Title = input.Title.Trim(), CommunityId = id, IsGroup = true };
        db.Conversations.Add(group); await db.SaveChangesAsync();
        db.ConversationMembers.AddRange(ids.Select(userId => new ConversationMember { ConversationId = group.Id, UserId = userId, IsAdmin = userId == Me }));
        await db.SaveChangesAsync(); await transaction.CommitAsync(); await NotifyCommunityAsync(id, ids, group.Id);
        return new JsonResult(new { group.Id });
    }
    public async Task<IActionResult> OnPostCommunityMembersAsync(int id, [FromBody] CommunityInput input)
    {
        if (!await db.CommunityMembers.AnyAsync(m => m.CommunityId == id && m.UserId == Me && m.IsAdmin)) return StatusCode(403, new { error = "Only community admins can do that." });
        if (input?.MemberIds == null || input.MemberIds.Count > 100) return BadRequest(new { error = "Choose up to 100 people." });
        var existing = await db.CommunityMembers.Where(m => m.CommunityId == id).Select(m => m.UserId).ToListAsync();
        var ids = input.MemberIds.Except(existing).Distinct().ToList();
        if (existing.Count + ids.Count > 500 || await db.Users.CountAsync(u => ids.Contains(u.Id)) != ids.Count) return BadRequest(new { error = "Check selected people. Communities support up to 500 members." });
        await using var transaction = await db.Database.BeginTransactionAsync();
        var groups = await db.Conversations.Where(c => c.CommunityId == id).Select(c => c.Id).ToListAsync();
        db.CommunityMembers.AddRange(ids.Select(userId => new CommunityMember { CommunityId = id, UserId = userId }));
        foreach (var group in groups) db.ConversationMembers.AddRange(ids.Select(userId => new ConversationMember { ConversationId = group, UserId = userId }));
        await db.SaveChangesAsync(); await transaction.CommitAsync();
        foreach (var group in groups) await NotifyCommunityAsync(id, ids.Concat(existing).ToList(), group);
        return new JsonResult(new { success = true });
    }
    public async Task<IActionResult> OnPostLeaveCommunityAsync(int id)
    {
        var member = await db.CommunityMembers.FirstOrDefaultAsync(m => m.CommunityId == id && m.UserId == Me);
        if (member == null) return NotFound();
        if (member.IsAdmin && !await db.CommunityMembers.AnyAsync(m => m.CommunityId == id && m.UserId != Me && m.IsAdmin)) return BadRequest(new { error = "Assign another admin before leaving your community." });
        var groups = await db.Conversations.Where(c => c.CommunityId == id).Select(c => c.Id).ToListAsync();
        await using var transaction = await db.Database.BeginTransactionAsync();
        await db.ConversationMembers.Where(m => m.UserId == Me && groups.Contains(m.ConversationId)).ExecuteDeleteAsync();
        db.CommunityMembers.Remove(member); await db.SaveChangesAsync(); await transaction.CommitAsync();
        foreach (var group in groups) foreach (var connection in presence.GetUserConnections(Me)) await hub.Groups.RemoveFromGroupAsync(connection, $"conv-{group}");
        await hub.Clients.User(Me.ToString()).SendAsync("CommunitiesChanged");
        return new JsonResult(new { success = true });
    }
    public async Task<IActionResult> OnPostCommunityAdminAsync(int id, int userId)
    {
        if (!await db.CommunityMembers.AnyAsync(m => m.CommunityId == id && m.UserId == Me && m.IsAdmin)) return StatusCode(403, new { error = "Only community admins can do that." });
        var member = await db.CommunityMembers.FirstOrDefaultAsync(m => m.CommunityId == id && m.UserId == userId);
        if (member == null) return NotFound(); member.IsAdmin = true;
        var groups = await db.Conversations.Where(c => c.CommunityId == id).Select(c => c.Id).ToListAsync();
        await db.ConversationMembers.Where(m => m.UserId == userId && groups.Contains(m.ConversationId)).ExecuteUpdateAsync(set => set.SetProperty(m => m.IsAdmin, true));
        await db.SaveChangesAsync(); await hub.Clients.User(userId.ToString()).SendAsync("CommunitiesChanged");
        return new JsonResult(new { success = true });
    }
    async Task NotifyCommunityAsync(int id, List<int> users, int conversationId)
    {
        foreach (var user in users) foreach (var connection in presence.GetUserConnections(user)) await hub.Groups.AddToGroupAsync(connection, $"conv-{conversationId}");
        await hub.Clients.Users(users.Select(user => user.ToString()).ToArray()).SendAsync("CommunitiesChanged");
    }
    public async Task<IActionResult> OnGetCallsAsync()
    {
        var rows = await db.CallRecords.AsNoTracking().Where(c => c.CallerId == Me || c.RecipientId == Me).OrderByDescending(c => c.CreatedAt).Take(50).ToListAsync();
        var peerIds = rows.Select(c => c.CallerId == Me ? c.RecipientId : c.CallerId).Distinct().ToList();
        var peers = await db.Users.Where(u => peerIds.Contains(u.Id)).ToDictionaryAsync(u => u.Id);
        return new JsonResult(rows.Select(c => new { c.Id, c.ConversationId, c.Video, c.State, outgoing = c.CallerId == Me,
            name = peers.GetValueOrDefault(c.CallerId == Me ? c.RecipientId : c.CallerId)?.DisplayName ?? "Deleted account",
            createdAt = Utc(c.CreatedAt), seconds = c.AnsweredAt.HasValue && c.EndedAt.HasValue ? Math.Max(0, (int)(c.EndedAt.Value - c.AnsweredAt.Value).TotalSeconds) : 0 }));
    }
    public IActionResult OnGetCallConfig()
    {
        var servers = new List<object>();
        var stun = config["Calls:StunUrls"] ?? "stun:stun.l.google.com:19302";
        if (!string.IsNullOrWhiteSpace(stun)) servers.Add(new { urls = stun.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries) });
        var turn = config["Calls:TurnUrls"];
        var secret = config["Calls:TurnSharedSecret"];
        var relay = !string.IsNullOrWhiteSpace(turn) && !string.IsNullOrWhiteSpace(secret);
        if (relay)
        {
            var username = $"{DateTimeOffset.UtcNow.AddHours(4).ToUnixTimeSeconds()}:{Me}";
            var credential = Convert.ToBase64String(HMACSHA1.HashData(Encoding.UTF8.GetBytes(secret!), Encoding.UTF8.GetBytes(username)));
            servers.Add(new { urls = turn!.Split(',', StringSplitOptions.TrimEntries | StringSplitOptions.RemoveEmptyEntries), username, credential });
        }
        return new JsonResult(new { iceServers = servers, relayConfigured = relay });
    }
}

