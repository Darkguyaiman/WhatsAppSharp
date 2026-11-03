CREATE TABLE `WebPushSubscriptions` (
  `Id` int NOT NULL AUTO_INCREMENT,
  `UserId` int NOT NULL,
  `Endpoint` varchar(2048) NOT NULL,
  `EndpointHash` varchar(64) NOT NULL,
  `P256dh` varchar(128) NOT NULL,
  `Auth` varchar(64) NOT NULL,
  `UpdatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`),
  CONSTRAINT `FK_WebPushSubscriptions_Users_UserId`
    FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;

CREATE INDEX `IX_Messages_ConversationId_Id` ON `Messages` (`ConversationId`, `Id`);
CREATE UNIQUE INDEX `IX_WebPushSubscriptions_EndpointHash` ON `WebPushSubscriptions` (`EndpointHash`);
CREATE INDEX `IX_WebPushSubscriptions_UserId` ON `WebPushSubscriptions` (`UserId`);
