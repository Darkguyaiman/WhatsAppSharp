namespace MessagingApp.Models;

public class ReactionSummaryDto
{
    [System.Text.Json.Serialization.JsonIgnore]
    public List<int> UserIds { get; set; } = new();
    public string Emoji { get; set; } = string.Empty;
    public int Count { get; set; }
    public bool HasReacted { get; set; }
    public List<string> UserNames { get; set; } = new();
}
