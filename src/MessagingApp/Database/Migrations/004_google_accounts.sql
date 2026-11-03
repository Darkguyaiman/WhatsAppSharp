ALTER TABLE `Users` ADD COLUMN `GoogleSubject` varchar(255) CHARACTER SET ascii COLLATE ascii_bin NULL;
CREATE UNIQUE INDEX `IX_Users_GoogleSubject` ON `Users` (`GoogleSubject`);
