using System.ComponentModel.DataAnnotations;

namespace MessagingApp.Models;

public class WebPushSubscription
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    [MaxLength(2048)] public string Endpoint { get; set; } = "";
    [MaxLength(64)] public string EndpointHash { get; set; } = "";
    [MaxLength(128)] public string P256dh { get; set; } = "";
    [MaxLength(64)] public string Auth { get; set; } = "";
    public DateTime UpdatedAt { get; set; }
}
