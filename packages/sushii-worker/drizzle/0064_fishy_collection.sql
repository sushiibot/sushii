CREATE TABLE "app_private"."fishy_interaction_results" (
	"interaction_id" bigint PRIMARY KEY NOT NULL,
	"user_id" bigint NOT NULL,
	"target_id" bigint NOT NULL,
	"result" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE "app_public"."user_fishy_collection" (
	"user_id" bigint NOT NULL,
	"collectible_id" text NOT NULL,
	"catch_count" integer DEFAULT 1 NOT NULL,
	"first_caught_at" timestamp with time zone NOT NULL,
	"last_caught_at" timestamp with time zone NOT NULL,
	CONSTRAINT "user_fishy_collection_user_id_collectible_id_pk" PRIMARY KEY("user_id","collectible_id"),
	CONSTRAINT "fishy_positive_count" CHECK ("app_public"."user_fishy_collection"."catch_count" > 0)
);

ALTER TABLE "app_private"."fishy_interaction_results" ADD CONSTRAINT "fishy_interaction_results_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "app_public"."user_fishy_collection" ADD CONSTRAINT "user_fishy_collection_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "app_public"."users"("id") ON DELETE cascade ON UPDATE no action;