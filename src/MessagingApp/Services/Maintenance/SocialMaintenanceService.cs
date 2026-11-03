using Microsoft.EntityFrameworkCore;
using MessagingApp.Data;

namespace MessagingApp.Services;

public sealed class SocialMaintenanceService(IServiceScopeFactory scopes, ILogger<SocialMaintenanceService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(5));
        do
        {
            try
            {
                using var scope = scopes.CreateScope();
                var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
                await db.StatusPosts.Where(s => s.ExpiresAt <= DateTime.UtcNow).ExecuteDeleteAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { return; }
            catch (Exception error) { logger.LogError(error, "Expired status cleanup failed"); }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
