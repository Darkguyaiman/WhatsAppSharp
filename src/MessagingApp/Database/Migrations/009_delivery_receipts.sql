CREATE TABLE `MessageDeliveries` (
  `MessageId` int NOT NULL, `UserId` int NOT NULL, `DeliveredAt` datetime(6) NOT NULL,
  PRIMARY KEY (`MessageId`,`UserId`), KEY `IX_MessageDeliveries_UserId` (`UserId`),
  FOREIGN KEY (`MessageId`) REFERENCES `Messages` (`Id`) ON DELETE CASCADE,
  FOREIGN KEY (`UserId`) REFERENCES `Users` (`Id`) ON DELETE RESTRICT
) CHARACTER SET utf8mb4;
-- A recorded read is also evidence of delivery; its time is the earliest known confirmation.
INSERT INTO `MessageDeliveries` (`MessageId`,`UserId`,`DeliveredAt`)
SELECT r.`MessageId`,r.`UserId`,r.`ReadAt` FROM `MessageReads` r
JOIN `Messages` m ON m.`Id`=r.`MessageId` WHERE r.`UserId`<>m.`SenderId`;
