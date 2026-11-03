CREATE TABLE `Communities` (
  `Id` int NOT NULL AUTO_INCREMENT, `Title` varchar(100) NOT NULL,
  `Description` varchar(500) NOT NULL, `CreatedAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`)
) CHARACTER SET utf8mb4;
CREATE TABLE `CommunityMembers` (
  `Id` int NOT NULL AUTO_INCREMENT, `CommunityId` int NOT NULL,
  `UserId` int NOT NULL, `IsAdmin` tinyint(1) NOT NULL,
  PRIMARY KEY (`Id`), UNIQUE KEY `IX_CommunityMembers_CommunityId_UserId` (`CommunityId`,`UserId`),
  KEY `IX_CommunityMembers_UserId` (`UserId`),
  FOREIGN KEY (`CommunityId`) REFERENCES `Communities` (`Id`) ON DELETE CASCADE,
  FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;
ALTER TABLE `Conversations` ADD COLUMN `CommunityId` int NULL, ADD COLUMN `IsAnnouncement` tinyint(1) NOT NULL DEFAULT 0,
  ADD INDEX `IX_Conversations_CommunityId` (`CommunityId`),
  ADD FOREIGN KEY (`CommunityId`) REFERENCES `Communities` (`Id`) ON DELETE SET NULL;
CREATE TABLE `StatusPosts` (
  `Id` int NOT NULL AUTO_INCREMENT, `UserId` int NOT NULL, `Text` varchar(700) NOT NULL,
  `ImageUrl` varchar(255) NULL, `Color` varchar(7) NOT NULL,
  `CreatedAt` datetime(6) NOT NULL, `ExpiresAt` datetime(6) NOT NULL,
  PRIMARY KEY (`Id`), KEY `IX_StatusPosts_ExpiresAt` (`ExpiresAt`), KEY `IX_StatusPosts_UserId` (`UserId`),
  FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;
CREATE TABLE `StatusViews` (
  `Id` int NOT NULL AUTO_INCREMENT, `StatusPostId` int NOT NULL, `UserId` int NOT NULL,
  `ViewedAt` datetime(6) NOT NULL, PRIMARY KEY (`Id`),
  UNIQUE KEY `IX_StatusViews_StatusPostId_UserId` (`StatusPostId`,`UserId`),
  FOREIGN KEY (`StatusPostId`) REFERENCES `StatusPosts` (`Id`) ON DELETE CASCADE
) CHARACTER SET utf8mb4;
CREATE TABLE `CallRecords` (
  `Id` varchar(32) NOT NULL, `ConversationId` int NOT NULL, `CallerId` int NOT NULL,
  `RecipientId` int NOT NULL, `Video` tinyint(1) NOT NULL, `State` varchar(20) NOT NULL,
  `CreatedAt` datetime(6) NOT NULL, `AnsweredAt` datetime(6) NULL, `EndedAt` datetime(6) NULL,
  PRIMARY KEY (`Id`), KEY `IX_CallRecords_CallerId_CreatedAt` (`CallerId`,`CreatedAt`),
  KEY `IX_CallRecords_RecipientId_CreatedAt` (`RecipientId`,`CreatedAt`)
) CHARACTER SET utf8mb4;
