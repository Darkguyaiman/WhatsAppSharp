namespace MessagingApp.Services;

public interface IUserPresenceService
{
    void AddConnection(int userId, string connectionId);
    void RemoveConnection(int userId, string connectionId);
    bool IsUserOnline(int userId);
    IReadOnlyCollection<int> GetOnlineUserIds();
    IReadOnlyCollection<string> GetUserConnections(int userId);
}
