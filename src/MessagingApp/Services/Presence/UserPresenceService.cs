using System.Collections.Concurrent;

namespace MessagingApp.Services;

public class UserPresenceService : IUserPresenceService
{
    // Mapping of UserId to Set of SignalR ConnectionIds
    private readonly ConcurrentDictionary<int, HashSet<string>> _userConnections = new();

    public void AddConnection(int userId, string connectionId)
    {
        _userConnections.AddOrUpdate(
            userId,
            _ => new HashSet<string> { connectionId },
            (_, connections) =>
            {
                lock (connections)
                {
                    connections.Add(connectionId);
                }
                return connections;
            });
    }

    public void RemoveConnection(int userId, string connectionId)
    {
        if (_userConnections.TryGetValue(userId, out var connections))
        {
            lock (connections)
            {
                connections.Remove(connectionId);
                if (connections.Count == 0)
                {
                    _userConnections.TryRemove(userId, out _);
                }
            }
        }
    }

    public bool IsUserOnline(int userId)
    {
        return _userConnections.TryGetValue(userId, out var connections) && connections.Count > 0;
    }

    public IReadOnlyCollection<int> GetOnlineUserIds()
    {
        return _userConnections.Keys.ToList();
    }

    public IReadOnlyCollection<string> GetUserConnections(int userId)
    {
        if (_userConnections.TryGetValue(userId, out var connections))
        {
            lock (connections)
            {
                return connections.ToList();
            }
        }
        return Array.Empty<string>();
    }
}
