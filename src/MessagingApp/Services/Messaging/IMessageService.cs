using MessagingApp.Models;

namespace MessagingApp.Services;

public interface IMessageService
{
    Task<List<MessageDto>> GetMessagesAsync(int conversationId, int currentUserId, int limit = 50, int? beforeMessageId = null);
    Task<MessageDto> SendMessageAsync(int conversationId, int senderId, string? content, MessageType type = MessageType.Text, string? attachmentUrl = null, string? attachmentName = null, long? attachmentSize = null, int? replyToMessageId = null, bool isForwarded = false);
    Task<List<int>> MarkConversationAsReadAsync(int conversationId, int userId);
    Task<List<MessageDto>> GetUndeliveredMessagesAsync(int userId);
    Task<List<DeliveryReceiptDto>> MarkMessagesDeliveredAsync(int[] messageIds, int userId);
    Task<(bool Success, MessageDto? Message, string? Error)> ToggleReactionAsync(int messageId, int userId, string emoji);
    Task<(bool Success, MessageDto? Message, string? Error)> EditMessageAsync(int messageId, int userId, string newContent);
    Task<(bool Success, MessageDto? Message, string? Error)> DeleteMessageAsync(int messageId, int userId);
    Task<List<MessageDto>> SearchMessagesAsync(int conversationId, int userId, string query);
    Task<MessageDto?> GetMessageDtoAsync(int messageId, int currentUserId);
    Task<List<MessageDto>> GetMessagesByIdsAsync(int[] messageIds, int currentUserId);
}
