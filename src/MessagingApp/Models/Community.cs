using System.ComponentModel.DataAnnotations;

namespace MessagingApp.Models;

public class Community
{
    public int Id { get; set; }
    [MaxLength(100)] public string Title { get; set; } = "";
    [MaxLength(500)] public string Description { get; set; } = "";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public ICollection<CommunityMember> Members { get; set; } = new List<CommunityMember>();
}

public class CommunityMember
{
    public int Id { get; set; }
    public int CommunityId { get; set; }
    public Community Community { get; set; } = null!;
    public int UserId { get; set; }
    public User User { get; set; } = null!;
    public bool IsAdmin { get; set; }
}
