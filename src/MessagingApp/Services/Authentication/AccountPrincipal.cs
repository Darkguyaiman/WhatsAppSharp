using System.Security.Claims;
using Microsoft.AspNetCore.Authentication.Cookies;
using MessagingApp.Models;

namespace MessagingApp.Services;

public static class AccountPrincipal
{
    public static ClaimsPrincipal Create(User user) => new(new ClaimsIdentity(new Claim[]
    {
        new(ClaimTypes.NameIdentifier, user.Id.ToString()),
        new(ClaimTypes.Name, user.Username),
        new("DisplayName", user.DisplayName),
        new("AvatarUrl", user.AvatarUrl ?? "/images/avatars/avatar-default.svg"),
        new(ClaimTypes.Email, user.Email)
    }, CookieAuthenticationDefaults.AuthenticationScheme));
}
