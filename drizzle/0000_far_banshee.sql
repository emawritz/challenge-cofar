CREATE TABLE `categories` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_name_unique` ON `categories` (`name`);--> statement-breakpoint
CREATE TABLE `ticket_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`ticket_id` integer NOT NULL,
	`type` text NOT NULL,
	`actor_id` integer NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`ticket_id`) REFERENCES `tickets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "events_type_chk" CHECK("ticket_events"."type" in ('CREATED','CLAIMED','RESOLVED','REOPENED','CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX `events_ticket_id_idx` ON `ticket_events` (`ticket_id`,`id`);--> statement-breakpoint
CREATE TABLE `tickets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`category_id` integer NOT NULL,
	`status` text NOT NULL,
	`requester_id` integer NOT NULL,
	`assignee_id` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignee_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tickets_status_chk" CHECK("tickets"."status" in ('OPEN','IN_PROGRESS','RESOLVED','CANCELLED'))
);
--> statement-breakpoint
CREATE INDEX `tickets_status_created_idx` ON `tickets` (`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `tickets_assignee_status_idx` ON `tickets` (`assignee_id`,`status`);--> statement-breakpoint
CREATE INDEX `tickets_category_idx` ON `tickets` (`category_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "users_role_chk" CHECK("users"."role" in ('REQUESTER','AGENT'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);