using System.ComponentModel.DataAnnotations;

namespace MessagingApp.Models;

public class StatusPost
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    [MaxLength(700)] public string Text { get; set; } = "";
    [MaxLength(255)] public string? ImageUrl { get; set; }
    [MaxLength(7)] public string Color { get; set; } = "#008069";
    [MaxLength(255)] public string Style { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime ExpiresAt { get; set; } = DateTime.UtcNow.AddHours(24);
    public ICollection<StatusView> Views { get; set; } = new List<StatusView>();
}

public class StatusView
{
    public int Id { get; set; }
    public int StatusPostId { get; set; }
    public StatusPost StatusPost { get; set; } = null!;
    public int UserId { get; set; }
    public DateTime ViewedAt { get; set; } = DateTime.UtcNow;
}
