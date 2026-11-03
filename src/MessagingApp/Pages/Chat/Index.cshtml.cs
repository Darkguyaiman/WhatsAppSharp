using System.Security.Claims;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.RazorPages;
using MessagingApp.Models;
using MessagingApp.Services;
using MessagingApp.Hubs;
using Microsoft.AspNetCore.SignalR;

namespace MessagingApp.Pages.Chat;

[Authorize]
public class IndexModel : PageModel
{
    private readonly IConversationService _conversationService;
    private readonly IMessageService _messageService;
    private readonly IAuthService _authService;
    private readonly IHubContext<ChatHub> _hub;
    private readonly IUserPresenceService _presence;

    public IndexModel(
        IConversationService conversationService,
        IMessageService messageService,
        IAuthService authService, IHubContext<ChatHub> hub, IUserPresenceService presence)
    {
        _conversationService = conversationService;
        _messageService = messageService;
        _authService = authService;
        _hub = hub;
        _presence = presence;
    }

    public int CurrentUserId => int.Parse(User.FindFirstValue(ClaimTypes.NameIdentifier)!);
    public User? CurrentUser { get; set; }
    public List<ConversationDto> Conversations { get; set; } = new();
    public ConversationDto? ActiveConversation { get; set; }
    public int? InitialConversationId { get; set; }
    public string? InitialFeature { get; set; }
    public int? InitialCommunityId { get; set; }
    public string ContactLink { get; private set; } = "";
    public bool OpenScanner { get; private set; }

    public async Task<IActionResult> OnGetAsync(int? conv = null, bool scan = false, int? communityId = null)
    {
        CurrentUser = await _authService.GetUserByIdAsync(CurrentUserId);
        if (CurrentUser == null)
        {
            return RedirectToPage("/Account/Login");
        }

        if (Request.Query.TryGetValue("feature", out var legacyFeature))
        {
            var target = legacyFeature.ToString() switch
            {
                "calls" => "/Calls",
                "statuses" => "/Statuses",
                "media" => "/Media",
                "communities" when int.TryParse(Request.Query["community"], out var id) => $"/Communities/{id}",
                "communities" => "/Communities",
                _ => null
            };
            if (target != null) return RedirectPermanent(target);
        }

        ContactLink = ContactCodes.Link(Request, CurrentUser.Username);
        OpenScanner = scan;
        Conversations = await _conversationService.GetUserConversationsAsync(CurrentUserId);
        InitialFeature = ResolveFeatureFromPath();
        InitialCommunityId = communityId;

        if (conv.HasValue)
        {
            InitialConversationId = conv.Value;
            ActiveConversation = await _conversationService.GetConversationDetailsAsync(conv.Value, CurrentUserId);
        }

        return Page();
    }

    string? ResolveFeatureFromPath()
    {
        var path = (Request.Path.Value ?? "").Trim('/');
        if (path.Equals("Calls", StringComparison.OrdinalIgnoreCase)) return "calls";
        if (path.Equals("Statuses", StringComparison.OrdinalIgnoreCase)) return "statuses";
        if (path.Equals("Media", StringComparison.OrdinalIgnoreCase)) return "media";
        if (path.Equals("Communities", StringComparison.OrdinalIgnoreCase)) return "communities";
        if (path.StartsWith("Communities/", StringComparison.OrdinalIgnoreCase)) return "communities";
        return null;
    }

    // API Handlers for client-side interactions
    public async Task<IActionResult> OnGetConversationsAsync(string? search = null)
    {
        var list = await _conversationService.GetUserConversationsAsync(CurrentUserId, search);
        return new JsonResult(list);
    }

    public async Task<IActionResult> OnGetMessagesAsync(int conversationId, int? beforeMessageId = null)
    {
        if (!await _conversationService.IsUserMemberAsync(conversationId, CurrentUserId))
        {
            return Forbid();
        }

        var messages = await _messageService.GetMessagesAsync(conversationId, CurrentUserId, 50, beforeMessageId);
        return new JsonResult(messages);
    }

    public async Task<IActionResult> OnGetSearchContactsAsync(string query)
    {
        var contacts = await _conversationService.SearchContactsAsync(CurrentUserId, query ?? "");
        return new JsonResult(contacts);
    }

    public async Task<IActionResult> OnGetMyContactCodeAsync()
    {
        var user = await _authService.GetUserByIdAsync(CurrentUserId);
        if (user == null) return Unauthorized();
        return new JsonResult(new
        {
            username = user.Username,
            displayName = user.DisplayName,
            link = ContactCodes.Link(Request, user.Username)
        });
    }

    public async Task<IActionResult> OnGetContactQrAsync()
    {
        var user = await _authService.GetUserByIdAsync(CurrentUserId);
        if (user == null) return Unauthorized();
        Response.Headers.CacheControl = "private, no-store";
        return Content(ContactCodes.ToSvg(ContactCodes.Link(Request, user.Username)), "image/svg+xml");
    }

    public async Task<IActionResult> OnGetContactByCodeAsync(string? code, string? username)
    {
        var resolved = ContactCodes.UsernameFrom(code) ?? (string.IsNullOrWhiteSpace(code) ? ContactCodes.NormalizeUsername(username) : null);
        if (resolved == null)
            return BadRequest(new { error = "That QR code isn’t a contact code." });

        var contact = await _conversationService.FindContactByUsernameAsync(CurrentUserId, resolved);
        if (contact != null) return new JsonResult(contact);

        var me = await _authService.GetUserByIdAsync(CurrentUserId);
        var error = me != null && me.Username == resolved
            ? "That’s your own QR code."
            : "No one here uses that code.";
        return NotFound(new { error });
    }

    public async Task<IActionResult> OnPostStartDirectChatAsync(int targetUserId)
    {
        if (targetUserId == CurrentUserId || await _authService.GetUserByIdAsync(targetUserId) == null)
            return BadRequest(new { error = "Choose another contact to start a chat." });
        var conv = await _conversationService.GetOrCreateDirectConversationAsync(CurrentUserId, targetUserId);
        await NotifyConversationAsync(conv.Id);
        return new JsonResult(conv);
    }

    public class CreateGroupModel
    {
        public string Title { get; set; } = string.Empty;
        public List<int> MemberIds { get; set; } = new();
    }

    public async Task<IActionResult> OnPostCreateGroupAsync([FromBody] CreateGroupModel model)
    {
        if (model == null || string.IsNullOrWhiteSpace(model.Title) || model.Title.Length > 100 || model.MemberIds == null || model.MemberIds.Count == 0 || model.MemberIds.Count > 100)
        {
            return BadRequest(new { error = "Title and at least one member required." });
        }

        foreach (var id in model.MemberIds.Distinct())
            if (await _authService.GetUserByIdAsync(id) == null) return BadRequest(new { error = "A selected contact no longer exists." });

        var conv = await _conversationService.CreateGroupConversationAsync(CurrentUserId, model.Title, model.MemberIds);
        await NotifyConversationAsync(conv.Id);
        return new JsonResult(conv);
    }

    public async Task<IActionResult> OnGetSearchMessagesAsync(int conversationId, string query)
    {
        if (!await _conversationService.IsUserMemberAsync(conversationId, CurrentUserId))
        {
            return Forbid();
        }

        var results = await _messageService.SearchMessagesAsync(conversationId, CurrentUserId, query);
        return new JsonResult(results);
    }

    private async Task NotifyConversationAsync(int conversationId)
    {
        var updates = await _conversationService.GetConversationUpdatesAsync(conversationId);
        foreach (var update in updates)
        {
            foreach (var connectionId in _presence.GetUserConnections(update.Key))
                await _hub.Groups.AddToGroupAsync(connectionId, $"conv-{conversationId}");
            await _hub.Clients.User(update.Key.ToString()).SendAsync("ConversationUpdated", update.Value);
        }
    }
}
