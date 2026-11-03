using MessagingApp.Models;

namespace MessagingApp.Services;

public interface IConversationService
{
    Task<List<ConversationDto>> GetUserConversationsAsync(int userId, string? search = null);
    Task<ConversationDto?> GetConversationDetailsAsync(int conversationId, int currentUserId);
    Task<Dictionary<int, ConversationDto>> GetConversationUpdatesAsync(int conversationId);
    Task<ConversationDto> GetOrCreateDirectConversationAsync(int currentUserId, int targetUserId);
    Task<ConversationDto> CreateGroupConversationAsync(int currentUserId, string title, List<int> memberIds);
    Task<bool> IsUserMemberAsync(int conversationId, int userId);
    Task<List<int>> GetConversationMemberUserIdsAsync(int conversationId);
    Task<List<UserDto>> SearchContactsAsync(int currentUserId, string query);
    Task<UserDto?> FindContactByUsernameAsync(int currentUserId, string username);
}
