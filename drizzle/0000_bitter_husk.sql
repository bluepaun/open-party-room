CREATE TABLE `lyar_games` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`word` text NOT NULL,
	`liar_player_id` text NOT NULL,
	`order` text NOT NULL,
	`phase` text DEFAULT 'reveal' NOT NULL,
	`explain_index` integer DEFAULT 0 NOT NULL,
	`confirmed` text DEFAULT '[]' NOT NULL,
	`votes` text DEFAULT '{}' NOT NULL,
	`accused_player_id` text,
	`guess` text,
	`result` text,
	`result_reason` text,
	`used_words` text DEFAULT '[]' NOT NULL,
	`turn_ended_at` integer,
	`started_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `players` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`code`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `players_room_name_unique` ON `players` (`room_id`,`name`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`code` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`game` text DEFAULT 'lyar' NOT NULL,
	`host_player_id` text,
	`status` text DEFAULT 'lobby' NOT NULL,
	`word_group_id` integer,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `word_groups` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `word_groups_name_unique` ON `word_groups` (`name`);--> statement-breakpoint
CREATE TABLE `words` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`group_id` integer NOT NULL,
	`word` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `word_groups`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `words_word_unique` ON `words` (`word`);
--> statement-breakpoint
-- 제시어 그룹 시드 (9그룹 × 10단어)
INSERT INTO `word_groups` (`id`, `name`, `sort`) VALUES
	(1, '먹거리', 1),
	(2, '일상 물건', 2),
	(3, '장소·교통', 3),
	(4, '축제·이벤트', 4),
	(5, '과학·판타지', 5),
	(6, '동물·자연', 6),
	(7, '몸·신체', 7),
	(8, '일상 활동', 8),
	(9, '수수께끼', 9);
--> statement-breakpoint
INSERT INTO `words` (`group_id`, `word`) VALUES
	(1, '치킨'), (1, '바나나'), (1, '피자'), (1, '호떡'), (1, '마라탕'),
	(1, '라면'), (1, '떡볶이'), (1, '아이스크림'), (1, '커피'), (1, '딸기'),
	(2, '양말'), (2, '우산'), (2, '자전거'), (2, '선풍기'), (2, '세탁기'),
	(2, '유리병'), (2, '시계'), (2, '풍선'), (2, '편지'), (2, '미로'),
	(3, '엘리베이터'), (3, '치과'), (3, '약국'), (3, '수영장'), (3, '기차'),
	(3, '비행기'), (3, '지도'), (3, '해변'), (3, '동물원'), (3, '도서관'),
	(4, '눈사람'), (4, '산타할아버지'), (4, '할로윈'), (4, '크리스마스'), (4, '생일잔치'),
	(4, '폭죽'), (4, '결혼식'), (4, '졸업식'), (4, '송년회'), (4, '밸런타인데이'),
	(5, '드론'), (5, '로봇'), (5, '레이저'), (5, '우주정거장'), (5, '화성'),
	(5, '심해'), (5, '로켓'), (5, '나침반'), (5, '별자리'), (5, '퍼즐'),
	(6, '거북이'), (6, '고양이'), (6, '강아지'), (6, '펭귄'), (6, '무지개'),
	(6, '사막'), (6, '빙하'), (6, '산호'), (6, '벼락'), (6, '폭풍우'),
	(7, '손가락'), (7, '발가락'), (7, '눈'), (7, '귀'), (7, '코'),
	(7, '팔'), (7, '다리'), (7, '어깨'), (7, '무릎'), (7, '배'),
	(8, '출근'), (8, '회의'), (8, '면접'), (8, '목욕'), (8, '양치질'),
	(8, '운전'), (8, '요리'), (8, '청소'), (8, '캠핑'), (8, '낚시'),
	(9, '지문'), (9, '비밀번호'), (9, '열쇠'), (9, '잠금장치'), (9, '금고'),
	(9, '보물찾기'), (9, '마법지팡이'), (9, '탈출방'), (9, '암호'), (9, '비밀통로');