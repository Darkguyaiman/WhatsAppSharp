using System.ComponentModel.DataAnnotations;

namespace MessagingApp.Models;

public enum MessageType
{
    Text = 0,
    Image = 1,
    Document = 2,
    Voice = 3
}

public class Message
{
    public int Id { get; set; }

    public int ConversationId { get; set; }
    public Conversation Conversation { get; set; } = null!;

    public int SenderId { get; set; }
    public User Sender { get; set; } = null!;

    public string? Content { get; set; }

    public MessageType Type { get; set; } = MessageType.Text;

    [MaxLength(255)]
    public string? AttachmentUrl { get; set; }

    [MaxLength(255)]
    public string? AttachmentName { get; set; }

    public long? AttachmentSize { get; set; }

    public int? ReplyToMessageId { get; set; }
    public Message? ReplyToMessage { get; set; }

    public bool IsEdited { get; set; } = false;
    public bool IsDeleted { get; set; } = false;
    public bool IsForwarded { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }

    public ICollection<MessageReaction> Reactions { get; set; } = new List<MessageReaction>();
    public ICollection<MessageRead> Reads { get; set; } = new List<MessageRead>();
    public ICollection<MessageDelivery> Deliveries { get; set; } = new List<MessageDelivery>();
    public ICollection<MessageUserState> UserStates { get; set; } = new List<MessageUserState>();
}
