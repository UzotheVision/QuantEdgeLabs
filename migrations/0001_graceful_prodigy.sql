CREATE TABLE "active_trades" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"asset_type" text NOT NULL,
	"direction" text NOT NULL,
	"option_type" text,
	"strike_price" real,
	"expiry_date" text,
	"entry_price" real NOT NULL,
	"quantity" double precision DEFAULT 1 NOT NULL,
	"entry_time" text NOT NULL,
	"target_price" real,
	"stop_loss" real,
	"current_price" real,
	"last_price_update" text,
	"unrealized_pnl" real,
	"unrealized_pnl_percent" real,
	"status" text DEFAULT 'open' NOT NULL,
	"exit_price" real,
	"exit_time" text,
	"realized_pnl" real,
	"realized_pnl_percent" real,
	"notes" text,
	"linked_trade_idea_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_credit_balances" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"tier_snapshot" varchar NOT NULL,
	"credits_allocated" integer DEFAULT 30 NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"credits_remaining" integer DEFAULT 30 NOT NULL,
	"cycle_start" timestamp DEFAULT now() NOT NULL,
	"cycle_end" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_usage_ledger" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"provider" varchar NOT NULL,
	"model" varchar NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"credits_debited" integer DEFAULT 1 NOT NULL,
	"estimated_cost_cents" real,
	"request_type" varchar DEFAULT 'research_assistant' NOT NULL,
	"question_preview" text,
	"response_time_ms" integer,
	"was_successful" boolean DEFAULT true NOT NULL,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "analysis_audit_log" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" varchar(100) NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"timestamp" timestamp DEFAULT now(),
	"engine_version" varchar DEFAULT 'UniversalEngine_v1.0',
	"params" jsonb,
	"result" jsonb,
	"duration" integer,
	"consumed_by" varchar,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "analysis_audit_log_audit_id_unique" UNIQUE("audit_id")
);
--> statement-breakpoint
CREATE TABLE "attention_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar NOT NULL,
	"source" text NOT NULL,
	"event_type" text NOT NULL,
	"event_data" jsonb,
	"score_weight" real DEFAULT 1,
	"occurred_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auto_lotto_preferences" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"risk_tolerance" text DEFAULT 'moderate' NOT NULL,
	"max_position_size" real DEFAULT 100 NOT NULL,
	"max_concurrent_trades" integer DEFAULT 5 NOT NULL,
	"daily_loss_limit" real DEFAULT 200,
	"options_allocation" real DEFAULT 40 NOT NULL,
	"futures_allocation" real DEFAULT 30 NOT NULL,
	"crypto_allocation" real DEFAULT 30 NOT NULL,
	"enable_options" boolean DEFAULT true NOT NULL,
	"enable_futures" boolean DEFAULT true NOT NULL,
	"enable_crypto" boolean DEFAULT true NOT NULL,
	"enable_prop_firm" boolean DEFAULT false NOT NULL,
	"options_preferred_dte" integer DEFAULT 7 NOT NULL,
	"options_max_dte" integer DEFAULT 14 NOT NULL,
	"options_min_delta" real DEFAULT 0.2 NOT NULL,
	"options_max_delta" real DEFAULT 0.4 NOT NULL,
	"options_prefer_calls" boolean DEFAULT true NOT NULL,
	"options_prefer_puts" boolean DEFAULT true NOT NULL,
	"options_preferred_symbols" text[],
	"futures_preferred_contracts" text[] DEFAULT ARRAY['NQ', 'ES', 'GC']::text[],
	"futures_max_contracts" integer DEFAULT 2 NOT NULL,
	"futures_stop_points" integer DEFAULT 15 NOT NULL,
	"futures_target_points" integer DEFAULT 30 NOT NULL,
	"crypto_preferred_coins" text[] DEFAULT ARRAY['BTC', 'ETH', 'SOL']::text[],
	"crypto_enable_meme_coins" boolean DEFAULT false NOT NULL,
	"crypto_max_leverage_multiplier" real DEFAULT 1 NOT NULL,
	"min_confidence_score" integer DEFAULT 70 NOT NULL,
	"preferred_holding_period" text DEFAULT 'day' NOT NULL,
	"min_risk_reward_ratio" real DEFAULT 2 NOT NULL,
	"use_dynamic_exits" boolean DEFAULT true NOT NULL,
	"trade_pre_market" boolean DEFAULT false NOT NULL,
	"trade_regular_hours" boolean DEFAULT true NOT NULL,
	"trade_after_hours" boolean DEFAULT false NOT NULL,
	"preferred_entry_windows" text[] DEFAULT ARRAY['09:30-11:00', '14:00-15:30']::text[],
	"enable_discord_alerts" boolean DEFAULT true NOT NULL,
	"enable_email_alerts" boolean DEFAULT false NOT NULL,
	"alert_on_entry" boolean DEFAULT true NOT NULL,
	"alert_on_exit" boolean DEFAULT true NOT NULL,
	"alert_on_daily_limit" boolean DEFAULT true NOT NULL,
	"automation_mode" text DEFAULT 'paper_only' NOT NULL,
	"require_confirmation" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "auto_lotto_preferences_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "beta_invites" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"token" varchar NOT NULL,
	"status" varchar DEFAULT 'pending',
	"tier_override" varchar,
	"notes" text,
	"sent_at" timestamp,
	"redeemed_at" timestamp,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "beta_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "beta_waitlist" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar NOT NULL,
	"source" varchar DEFAULT 'landing',
	"referral_code" varchar,
	"status" varchar DEFAULT 'pending',
	"notified_discord" boolean DEFAULT false,
	"invite_sent" boolean DEFAULT false,
	"converted_to_user" boolean DEFAULT false,
	"invite_id" varchar,
	"last_contacted_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "beta_waitlist_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "blog_posts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar NOT NULL,
	"title" varchar NOT NULL,
	"excerpt" text,
	"content" text NOT NULL,
	"hero_image_url" varchar,
	"category" text DEFAULT 'market-commentary' NOT NULL,
	"tags" text[],
	"author_id" varchar,
	"author_name" varchar DEFAULT 'Trading Education Team' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"meta_description" text,
	"meta_keywords" text,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "blog_posts_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "bot_learning_state" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"confidence_threshold" real DEFAULT 65,
	"stop_loss_multiplier" real DEFAULT 1,
	"position_size_multiplier" real DEFAULT 1,
	"symbol_adjustments" jsonb DEFAULT '{}'::jsonb,
	"pattern_adjustments" jsonb DEFAULT '{}'::jsonb,
	"total_analyzed" integer DEFAULT 0,
	"total_wins" integer DEFAULT 0,
	"total_losses" integer DEFAULT 0,
	"adaptations_applied" integer DEFAULT 0,
	"last_updated" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bullish_trends" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar NOT NULL,
	"name" varchar,
	"sector" varchar,
	"category" text DEFAULT 'momentum',
	"current_price" real,
	"previous_close" real,
	"day_change" real,
	"day_change_percent" real,
	"week_change_percent" real,
	"month_change_percent" real,
	"rsi_14" real,
	"rsi_2" real,
	"macd_signal" varchar,
	"sma_20" real,
	"sma_50" real,
	"sma_200" real,
	"price_vs_sma_20" real,
	"price_vs_sma_50" real,
	"price_vs_sma_200" real,
	"current_volume" real,
	"avg_volume" real,
	"volume_ratio" real,
	"trend_strength" text DEFAULT 'moderate',
	"trend_phase" text DEFAULT 'momentum',
	"momentum_score" integer,
	"week_52_high" real,
	"week_52_low" real,
	"percent_from_52_high" real,
	"percent_from_52_low" real,
	"resistance_level" real,
	"support_level" real,
	"is_breakout" boolean DEFAULT false,
	"is_high_volume" boolean DEFAULT false,
	"is_above_mas" boolean DEFAULT false,
	"is_new_high" boolean DEFAULT false,
	"added_manually" boolean DEFAULT false,
	"added_by" varchar,
	"notes" text,
	"alert_sent" boolean DEFAULT false,
	"last_alert_date" timestamp,
	"is_active" boolean DEFAULT true,
	"discovered_at" timestamp DEFAULT now(),
	"last_scanned_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "catalyst_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" varchar NOT NULL,
	"company_name" text,
	"event_type" text NOT NULL,
	"source_id" varchar,
	"source_table" text,
	"title" text NOT NULL,
	"summary" text,
	"event_date" text NOT NULL,
	"signal_strength" real DEFAULT 0 NOT NULL,
	"polarity" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"expires_at" text,
	"is_active" boolean DEFAULT true,
	"was_used_in_trade" boolean DEFAULT false,
	"trade_idea_id" varchar,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "confidence_calibration" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"confidence_band_min" real NOT NULL,
	"confidence_band_max" real NOT NULL,
	"band_label" varchar NOT NULL,
	"total_predictions" integer DEFAULT 0 NOT NULL,
	"closed_predictions" integer DEFAULT 0 NOT NULL,
	"correct_predictions" integer DEFAULT 0 NOT NULL,
	"actual_win_rate" real DEFAULT 0,
	"expected_win_rate" real DEFAULT 0,
	"calibration_error" real DEFAULT 0,
	"avg_pnl_percent" real DEFAULT 0,
	"avg_pnl_dollars" real DEFAULT 0,
	"ai_predictions" integer DEFAULT 0,
	"ai_win_rate" real DEFAULT 0,
	"quant_predictions" integer DEFAULT 0,
	"quant_win_rate" real DEFAULT 0,
	"last_updated" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"type" varchar NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"feature_id" varchar,
	"description" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ct_call_performance" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mention_id" varchar NOT NULL,
	"source_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"direction" text NOT NULL,
	"call_price" real NOT NULL,
	"target_price" real,
	"stop_loss" real,
	"outcome" text DEFAULT 'pending' NOT NULL,
	"exit_price" real,
	"pnl_percent" real,
	"resolved_at" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ct_mentions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_id" varchar NOT NULL,
	"post_url" text,
	"post_text" text NOT NULL,
	"tickers" text[],
	"sentiment" text DEFAULT 'neutral' NOT NULL,
	"sentiment_score" real,
	"is_call" boolean DEFAULT false,
	"call_direction" text,
	"call_target_price" real,
	"call_stop_loss" real,
	"likes_count" integer,
	"retweets_count" integer,
	"replies_count" integer,
	"posted_at" text NOT NULL,
	"fetched_at" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ct_sources" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text,
	"profile_image_url" text,
	"followers_count" integer,
	"historical_accuracy" real,
	"is_active" boolean DEFAULT true,
	"last_fetch_at" text,
	"fetch_error_count" integer DEFAULT 0,
	"is_verified" boolean DEFAULT false,
	"category" text,
	"auto_follow_trades" boolean DEFAULT false,
	"max_auto_trade_size" real DEFAULT 100,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "daily_usage" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"date" text NOT NULL,
	"ideas_viewed" integer DEFAULT 0 NOT NULL,
	"ai_chat_messages" integer DEFAULT 0 NOT NULL,
	"chart_analyses" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dynamic_signal_weights" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_name" text NOT NULL,
	"current_weight" real DEFAULT 1 NOT NULL,
	"base_weight" real DEFAULT 1 NOT NULL,
	"correct_predictions" integer DEFAULT 0,
	"incorrect_predictions" integer DEFAULT 0,
	"accuracy" real DEFAULT 50,
	"last_adjusted" timestamp,
	"adjustment_history" jsonb,
	"min_weight" real DEFAULT 0.2,
	"max_weight" real DEFAULT 2,
	"regime_adjustments" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "dynamic_signal_weights_signal_name_unique" UNIQUE("signal_name")
);
--> statement-breakpoint
CREATE TABLE "engine_daily_metrics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" text NOT NULL,
	"engine" text NOT NULL,
	"ideas_generated" integer DEFAULT 0 NOT NULL,
	"ideas_published" integer DEFAULT 0 NOT NULL,
	"trades_resolved" integer DEFAULT 0 NOT NULL,
	"trades_won" integer DEFAULT 0 NOT NULL,
	"trades_lost" integer DEFAULT 0 NOT NULL,
	"trades_expired" integer DEFAULT 0 NOT NULL,
	"win_rate" real,
	"avg_gain_percent" real,
	"avg_loss_percent" real,
	"expectancy" real,
	"avg_holding_time_minutes" real,
	"avg_time_to_target" real,
	"avg_time_to_stop" real,
	"avg_confidence_score" real,
	"confidence_by_band" jsonb,
	"max_drawdown_percent" real,
	"sharpe_ratio" real,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "engine_health_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"engine" text NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text NOT NULL,
	"message" text NOT NULL,
	"details" jsonb,
	"acknowledged" boolean DEFAULT false,
	"acknowledged_by" varchar,
	"acknowledged_at" text,
	"resolved" boolean DEFAULT false,
	"resolved_at" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "futures_research_briefs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"current_price" real NOT NULL,
	"session" text NOT NULL,
	"bias" text NOT NULL,
	"bias_strength" text NOT NULL,
	"technical_summary" text NOT NULL,
	"session_context" text NOT NULL,
	"resistance_levels" text[],
	"support_levels" text[],
	"pivot_level" real,
	"catalysts" text[],
	"risk_factors" text[],
	"trade_direction" text,
	"trade_entry" real,
	"trade_target" real,
	"trade_stop" real,
	"trade_rationale" text,
	"generated_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	"source" text DEFAULT 'ai',
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "government_contracts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"award_id" varchar NOT NULL,
	"piid" varchar,
	"recipient_name" text NOT NULL,
	"recipient_ticker" varchar,
	"recipient_duns" varchar,
	"awarding_agency_name" text NOT NULL,
	"awarding_agency_code" varchar,
	"funding_agency_name" text,
	"description" text,
	"contract_type" text,
	"naics_code" varchar,
	"naics_description" text,
	"obligation_amount" real NOT NULL,
	"total_outlay_amount" real,
	"base_exercised_value" real,
	"award_date" text NOT NULL,
	"start_date" text,
	"end_date" text,
	"is_defense" boolean DEFAULT false,
	"is_healthcare" boolean DEFAULT false,
	"is_technology" boolean DEFAULT false,
	"significance_score" real DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "government_contracts_award_id_unique" UNIQUE("award_id")
);
--> statement-breakpoint
CREATE TABLE "historical_intelligence_summary" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"total_ideas_generated" integer DEFAULT 0 NOT NULL,
	"total_ideas_closed" integer DEFAULT 0 NOT NULL,
	"overall_win_rate" real DEFAULT 0,
	"overall_profit_factor" real DEFAULT 0,
	"total_realized_pnl" real DEFAULT 0,
	"ai_ideas" integer DEFAULT 0,
	"ai_win_rate" real DEFAULT 0,
	"quant_ideas" integer DEFAULT 0,
	"quant_win_rate" real DEFAULT 0,
	"flow_ideas" integer DEFAULT 0,
	"flow_win_rate" real DEFAULT 0,
	"stock_win_rate" real DEFAULT 0,
	"options_win_rate" real DEFAULT 0,
	"crypto_win_rate" real DEFAULT 0,
	"futures_win_rate" real DEFAULT 0,
	"long_win_rate" real DEFAULT 0,
	"short_win_rate" real DEFAULT 0,
	"top_symbols_by_win_rate" jsonb,
	"top_catalysts_by_win_rate" jsonb,
	"best_time_of_day" varchar,
	"confidence_calibration_score" real DEFAULT 0,
	"avg_overconfidence" real DEFAULT 0,
	"ml_model_version" varchar,
	"ml_model_accuracy" real DEFAULT 0,
	"last_ml_training_date" timestamp,
	"data_range_start" timestamp,
	"data_range_end" timestamp,
	"last_updated" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "iv_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"date" varchar(10) NOT NULL,
	"atm_iv" double precision NOT NULL,
	"rv20" double precision,
	"rv10" double precision,
	"spot_price" double precision,
	"pcr" double precision,
	"vix" double precision,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "layout_presets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"page_id" varchar NOT NULL,
	"name" varchar NOT NULL,
	"description" text,
	"thumbnail" text,
	"widgets" jsonb DEFAULT '[]'::jsonb,
	"columns" integer DEFAULT 12,
	"row_height" integer DEFAULT 60,
	"panel_sizes" jsonb,
	"is_system_preset" boolean DEFAULT true,
	"category" varchar DEFAULT 'default',
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "loss_analysis" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_idea_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"engine" text NOT NULL,
	"asset_type" text NOT NULL,
	"direction" text NOT NULL,
	"confidence_score" real,
	"probability_band" text,
	"entry_price" real NOT NULL,
	"exit_price" real NOT NULL,
	"percent_loss" real NOT NULL,
	"dollar_loss" real,
	"holding_time_minutes" integer,
	"loss_reason" text DEFAULT 'unknown' NOT NULL,
	"severity" text DEFAULT 'moderate' NOT NULL,
	"market_condition_at_entry" text,
	"vix_level_at_entry" real,
	"sector_performance" text,
	"time_of_day" text,
	"day_of_week" text,
	"what_went_wrong" text NOT NULL,
	"lessons_learned" text,
	"prevention_strategy" text,
	"is_pattern_match" boolean DEFAULT false,
	"pattern_type" text,
	"similar_losses" text[],
	"ai_analysis" text,
	"ai_recommendations" text[],
	"analyzed_at" timestamp DEFAULT now(),
	"analyzed_by" text DEFAULT 'system',
	"reviewed_by_user" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ml_model_registry" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_name" text NOT NULL,
	"version" text NOT NULL,
	"trained_at" timestamp DEFAULT now() NOT NULL,
	"training_data_start" timestamp,
	"training_data_end" timestamp,
	"samples_used" integer DEFAULT 0,
	"hyperparameters" jsonb,
	"feature_set" jsonb,
	"signal_weights" jsonb,
	"backtest_accuracy" real,
	"backtest_precision" real,
	"backtest_recall" real,
	"backtest_f1" real,
	"backtest_sharpe" real,
	"backtest_max_drawdown" real,
	"live_accuracy" real,
	"live_predictions" integer DEFAULT 0,
	"live_wins" integer DEFAULT 0,
	"live_losses" integer DEFAULT 0,
	"live_win_rate" real,
	"live_profit_factor" real,
	"status" text DEFAULT 'training',
	"is_champion" boolean DEFAULT false,
	"deployed_at" timestamp,
	"deprecated_at" timestamp,
	"deprecation_reason" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ml_retraining_jobs" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"model_name" text NOT NULL,
	"job_type" text DEFAULT 'scheduled',
	"status" text DEFAULT 'queued',
	"started_at" timestamp,
	"completed_at" timestamp,
	"samples_available" integer DEFAULT 0,
	"samples_used" integer DEFAULT 0,
	"data_range_start" timestamp,
	"data_range_end" timestamp,
	"previous_model_version" text,
	"new_model_version" text,
	"accuracy_improvement" real,
	"performance_gate" boolean,
	"gate_reason" text,
	"auto_deployed" boolean DEFAULT false,
	"deployment_notes" text,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ml_training_samples" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_idea_id" varchar,
	"symbol" varchar NOT NULL,
	"asset_type" text,
	"predicted_direction" text NOT NULL,
	"predicted_confidence" real NOT NULL,
	"prediction_engine" text NOT NULL,
	"model_version" text,
	"features" jsonb,
	"signal_weights" jsonb,
	"price_at_prediction" real NOT NULL,
	"target_price" real,
	"stop_loss" real,
	"market_regime" text,
	"sector_performance" real,
	"outcome_status" text DEFAULT 'pending',
	"actual_direction" text,
	"actual_price_change" real,
	"exit_price" real,
	"realized_pnl" real,
	"days_to_outcome" integer,
	"closed_at" timestamp,
	"closure_reason" text,
	"is_usable_for_training" boolean DEFAULT false,
	"error_category" text,
	"predicted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "options_flow_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"option_type" text NOT NULL,
	"strike_price" real NOT NULL,
	"expiration_date" text NOT NULL,
	"volume" integer NOT NULL,
	"open_interest" integer,
	"volume_oi_ratio" real,
	"premium" real NOT NULL,
	"total_premium" real,
	"implied_volatility" real,
	"delta" real,
	"underlying_price" real,
	"sentiment" text NOT NULL,
	"flow_type" text NOT NULL,
	"unusual_score" real NOT NULL,
	"strategy_category" text DEFAULT 'institutional',
	"dte_category" text DEFAULT 'swing',
	"is_lotto" boolean DEFAULT false,
	"is_watchlist_symbol" boolean DEFAULT false,
	"detected_at" timestamp DEFAULT now(),
	"detected_date" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_views" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar,
	"session_id" varchar,
	"path" varchar NOT NULL,
	"referrer" text,
	"viewed_at" timestamp DEFAULT now(),
	"time_on_page" integer,
	"user_agent" text,
	"device" varchar,
	"browser" varchar,
	"utm_source" varchar,
	"utm_medium" varchar,
	"utm_campaign" varchar
);
--> statement-breakpoint
CREATE TABLE "paper_equity_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" varchar NOT NULL,
	"date" text NOT NULL,
	"total_value" real NOT NULL,
	"cash_balance" real NOT NULL,
	"positions_value" real NOT NULL,
	"daily_pnl" real DEFAULT 0 NOT NULL,
	"daily_pnl_percent" real DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "paper_portfolios" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"name" text DEFAULT 'My Paper Portfolio' NOT NULL,
	"starting_capital" real DEFAULT 100000 NOT NULL,
	"cash_balance" real DEFAULT 100000 NOT NULL,
	"total_value" real DEFAULT 100000 NOT NULL,
	"total_pnl" real DEFAULT 0 NOT NULL,
	"total_pnl_percent" real DEFAULT 0 NOT NULL,
	"win_count" integer DEFAULT 0 NOT NULL,
	"loss_count" integer DEFAULT 0 NOT NULL,
	"auto_execute" boolean DEFAULT false,
	"max_position_size" real DEFAULT 5000,
	"risk_per_trade" real DEFAULT 0.02,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "paper_positions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"portfolio_id" varchar NOT NULL,
	"trade_idea_id" varchar,
	"symbol" text NOT NULL,
	"asset_type" text NOT NULL,
	"direction" text NOT NULL,
	"option_type" text,
	"strike_price" real,
	"expiry_date" text,
	"entry_price" real NOT NULL,
	"quantity" double precision NOT NULL,
	"entry_time" text NOT NULL,
	"entry_reason" text,
	"entry_signals" text,
	"target_price" real,
	"stop_loss" real,
	"high_water_mark" real,
	"trailing_stop_percent" real DEFAULT 25,
	"trailing_stop_price" real,
	"use_trailing_stop" boolean DEFAULT true,
	"current_price" real,
	"last_price_update" text,
	"unrealized_pnl" real DEFAULT 0,
	"unrealized_pnl_percent" real DEFAULT 0,
	"status" text DEFAULT 'open' NOT NULL,
	"exit_price" real,
	"exit_time" text,
	"exit_reason" text,
	"realized_pnl" real,
	"realized_pnl_percent" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"email" varchar NOT NULL,
	"token" varchar NOT NULL,
	"used" boolean DEFAULT false,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "pattern_signals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar NOT NULL,
	"pattern_type" text NOT NULL,
	"pattern_status" text DEFAULT 'forming' NOT NULL,
	"timeframe" text DEFAULT 'daily' NOT NULL,
	"detected_at" timestamp DEFAULT now() NOT NULL,
	"confirmed_at" timestamp,
	"detection_price" real NOT NULL,
	"current_price" real,
	"resistance_level" real,
	"support_level" real,
	"breakout_level" real,
	"target_price" real,
	"stop_loss" real,
	"pattern_score" integer DEFAULT 50 NOT NULL,
	"volume_confirmation" boolean DEFAULT false,
	"price_confirmation" boolean DEFAULT false,
	"pattern_height" real,
	"pattern_duration" integer,
	"consolidation_tightness" real,
	"rsi_value" real,
	"macd_signal" varchar,
	"volume_ratio" real,
	"price_vs_sma_20" real,
	"price_vs_sma_50" real,
	"risk_reward_ratio" real,
	"distance_to_breakout" real,
	"estimated_breakout_date" timestamp,
	"urgency" varchar,
	"trade_idea_id" varchar,
	"notes" text,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "platform_reports" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"period" text NOT NULL,
	"start_date" text NOT NULL,
	"end_date" text NOT NULL,
	"status" text DEFAULT 'generating' NOT NULL,
	"total_ideas_generated" integer DEFAULT 0,
	"ai_ideas_generated" integer DEFAULT 0,
	"quant_ideas_generated" integer DEFAULT 0,
	"hybrid_ideas_generated" integer DEFAULT 0,
	"total_trades_resolved" integer DEFAULT 0,
	"total_wins" integer DEFAULT 0,
	"total_losses" integer DEFAULT 0,
	"overall_win_rate" real,
	"avg_gain_percent" real,
	"avg_loss_percent" real,
	"total_pnl_percent" real,
	"ai_win_rate" real,
	"quant_win_rate" real,
	"hybrid_win_rate" real,
	"best_performing_engine" text,
	"auto_lotto_trades" integer DEFAULT 0,
	"auto_lotto_pnl" real DEFAULT 0,
	"futures_bot_trades" integer DEFAULT 0,
	"futures_bot_pnl" real DEFAULT 0,
	"crypto_bot_trades" integer DEFAULT 0,
	"crypto_bot_pnl" real DEFAULT 0,
	"prop_firm_trades" integer DEFAULT 0,
	"prop_firm_pnl" real DEFAULT 0,
	"options_flow_alerts" integer DEFAULT 0,
	"market_scanner_symbols_tracked" integer DEFAULT 0,
	"ct_tracker_mentions" integer DEFAULT 0,
	"ct_tracker_auto_trades" integer DEFAULT 0,
	"stock_trade_count" integer DEFAULT 0,
	"options_trade_count" integer DEFAULT 0,
	"crypto_trade_count" integer DEFAULT 0,
	"futures_trade_count" integer DEFAULT 0,
	"top_winning_symbols" jsonb,
	"top_losing_symbols" jsonb,
	"active_users" integer DEFAULT 0,
	"new_users" integer DEFAULT 0,
	"report_data" jsonb,
	"generated_by" varchar,
	"generated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "premium_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"option_type" text NOT NULL,
	"strike_price" real NOT NULL,
	"expiration_date" text NOT NULL,
	"premium" real NOT NULL,
	"underlying_price" real,
	"implied_volatility" real,
	"delta" real,
	"snapshot_date" text NOT NULL,
	"snapshot_time" text,
	"premium_change" real,
	"premium_change_dollar" real,
	"avg_premium_30d" real,
	"percentile_rank" real
);
--> statement-breakpoint
CREATE TABLE "research_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"signal_id" varchar,
	"action_taken" text NOT NULL,
	"signal_grade" text,
	"signal_confidence" real,
	"signal_direction" text,
	"signal_engine" text,
	"signal_price" real,
	"technical_snapshot" text,
	"market_regime" text,
	"outcome" text,
	"outcome_return" real,
	"outcome_pnl" real,
	"outcome_updated_at" timestamp,
	"decision_notes" text,
	"lesson_learned" text,
	"signal_patterns" text[],
	"viewed_at" timestamp DEFAULT now(),
	"decided_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sec_filing_signals" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filing_id" varchar NOT NULL,
	"signal_type" text NOT NULL,
	"polarity" text NOT NULL,
	"confidence" real DEFAULT 0.5 NOT NULL,
	"weight" real DEFAULT 1 NOT NULL,
	"raw_context" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sec_filings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"accession_number" varchar NOT NULL,
	"cik" varchar NOT NULL,
	"ticker" varchar,
	"company_name" text NOT NULL,
	"filing_type" text NOT NULL,
	"filing_date" text NOT NULL,
	"acceptance_date" text,
	"filing_url" text NOT NULL,
	"document_count" integer DEFAULT 1,
	"extracted_summary" text,
	"sentiment" text DEFAULT 'neutral',
	"sentiment_score" real DEFAULT 0,
	"catalyst_tags" text[],
	"revenue_change" real,
	"eps_change" real,
	"guidance_direction" text,
	"insider_shares" integer,
	"insider_value" real,
	"insider_direction" text,
	"parsed_at" timestamp,
	"is_processed" boolean DEFAULT false,
	"processing_error" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "sec_filings_accession_number_unique" UNIQUE("accession_number")
);
--> statement-breakpoint
CREATE TABLE "signal_performance" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_name" text NOT NULL,
	"total_trades" integer DEFAULT 0 NOT NULL,
	"win_count" integer DEFAULT 0 NOT NULL,
	"loss_count" integer DEFAULT 0 NOT NULL,
	"open_count" integer DEFAULT 0 NOT NULL,
	"win_rate" real DEFAULT 0 NOT NULL,
	"avg_win_percent" real DEFAULT 0 NOT NULL,
	"avg_loss_percent" real DEFAULT 0 NOT NULL,
	"profit_factor" real DEFAULT 0 NOT NULL,
	"expectancy" real DEFAULT 0 NOT NULL,
	"stock_win_rate" real DEFAULT 0,
	"option_win_rate" real DEFAULT 0,
	"crypto_win_rate" real DEFAULT 0,
	"recent_win_rate" real DEFAULT 0,
	"trend_direction" text DEFAULT 'stable',
	"reliability_score" real DEFAULT 0,
	"sample_size_grade" text DEFAULT 'F',
	"last_calculated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "signal_performance_signal_name_unique" UNIQUE("signal_name")
);
--> statement-breakpoint
CREATE TABLE "symbol_behavior_profiles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar NOT NULL,
	"total_ideas" integer DEFAULT 0 NOT NULL,
	"closed_ideas" integer DEFAULT 0 NOT NULL,
	"wins" integer DEFAULT 0 NOT NULL,
	"losses" integer DEFAULT 0 NOT NULL,
	"breakevens" integer DEFAULT 0 NOT NULL,
	"overall_win_rate" real DEFAULT 0,
	"long_win_rate" real DEFAULT 0,
	"short_win_rate" real DEFAULT 0,
	"options_win_rate" real DEFAULT 0,
	"total_pnl" real DEFAULT 0,
	"avg_win_amount" real DEFAULT 0,
	"avg_loss_amount" real DEFAULT 0,
	"avg_win_percent" real DEFAULT 0,
	"avg_loss_percent" real DEFAULT 0,
	"profit_factor" real DEFAULT 0,
	"avg_confidence_score" real DEFAULT 0,
	"actual_win_rate_vs_predicted" real DEFAULT 0,
	"best_catalyst_type" varchar,
	"best_catalyst_win_rate" real DEFAULT 0,
	"worst_catalyst_type" varchar,
	"worst_catalyst_win_rate" real DEFAULT 0,
	"best_session_phase" varchar,
	"best_session_win_rate" real DEFAULT 0,
	"best_volatility_regime" varchar,
	"best_volatility_win_rate" real DEFAULT 0,
	"sector" varchar,
	"industry" varchar,
	"avg_volume" real,
	"market_cap" varchar,
	"last_trade_date" timestamp,
	"profile_updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "symbol_behavior_profiles_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "symbol_catalyst_responses" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar NOT NULL,
	"trade_idea_id" varchar NOT NULL,
	"catalyst_category" varchar NOT NULL,
	"catalyst_text" text,
	"catalyst_date" timestamp NOT NULL,
	"direction" varchar NOT NULL,
	"asset_type" varchar NOT NULL,
	"entry_price" real NOT NULL,
	"target_price" real NOT NULL,
	"stop_loss" real NOT NULL,
	"confidence_score" real,
	"outcome_status" varchar,
	"exit_price" real,
	"pnl_percent" real,
	"pnl_dollars" real,
	"holding_time_minutes" integer,
	"volatility_regime" varchar,
	"session_phase" varchar,
	"market_condition" varchar,
	"max_favorable_move" real,
	"max_adverse_move" real,
	"time_to_max_favorable" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "symbol_catalyst_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticker" varchar NOT NULL,
	"bullish_catalyst_count" integer DEFAULT 0,
	"bearish_catalyst_count" integer DEFAULT 0,
	"neutral_catalyst_count" integer DEFAULT 0,
	"aggregate_catalyst_score" real DEFAULT 0,
	"recent_catalysts" jsonb,
	"last_sec_filing_date" text,
	"last_sec_filing_type" text,
	"last_gov_contract_date" text,
	"last_gov_contract_value" real,
	"last_updated" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "symbol_catalyst_snapshots_ticker_unique" UNIQUE("ticker")
);
--> statement-breakpoint
CREATE TABLE "symbol_heat_scores" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar NOT NULL,
	"heat_score" real DEFAULT 0,
	"raw_touch_count" integer DEFAULT 0,
	"distinct_sources" integer DEFAULT 0,
	"recent_touches_1h" integer DEFAULT 0,
	"recent_touches_24h" integer DEFAULT 0,
	"source_breakdown" jsonb,
	"last_source" text,
	"last_event_type" text,
	"last_price" real,
	"last_direction" varchar,
	"is_converging" boolean DEFAULT false,
	"convergence_level" integer DEFAULT 0,
	"first_touch_at" timestamp,
	"last_touch_at" timestamp,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "symbol_heat_scores_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "symbol_notes" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"watchlist_id" varchar,
	"content" text NOT NULL,
	"tags" text[],
	"note_type" text DEFAULT 'user',
	"is_private" boolean DEFAULT true,
	"linked_event_type" text,
	"linked_event_id" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "testimonials" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar NOT NULL,
	"title" varchar,
	"company" varchar,
	"avatar_url" varchar,
	"quote" text NOT NULL,
	"rating" integer DEFAULT 5,
	"featured" boolean DEFAULT false,
	"display_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tracked_wallets" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"address" text NOT NULL,
	"network" text NOT NULL,
	"label" text,
	"category" text,
	"is_active" boolean DEFAULT true,
	"last_sync_at" text,
	"sync_error_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_diagnostics" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" varchar NOT NULL,
	"trade_source" text NOT NULL,
	"symbol" text NOT NULL,
	"outcome" text NOT NULL,
	"pnl_percent" real NOT NULL,
	"pnl_dollars" real,
	"entry_snapshot" jsonb,
	"exit_snapshot" jsonb,
	"loss_categories" text[],
	"primary_cause" text,
	"analysis_notes" text,
	"remediation_actions" jsonb,
	"pattern_hash" text,
	"similar_loss_count" integer DEFAULT 0,
	"review_status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_input_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_idea_id" varchar NOT NULL,
	"engine" text NOT NULL,
	"signal_inputs" jsonb,
	"volume_at_entry" real,
	"rsi_at_entry" real,
	"iv_at_entry" real,
	"premium_at_entry" real,
	"skew_ratio_at_entry" real,
	"confidence_total" real,
	"confidence_breakdown" jsonb,
	"quality_band" text,
	"market_session_at_entry" text,
	"vix_at_entry" real,
	"spy_change_at_entry" real,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trade_price_snapshots" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_idea_id" varchar NOT NULL,
	"event_type" text NOT NULL,
	"event_timestamp" text NOT NULL,
	"current_price" real NOT NULL,
	"bid_price" real,
	"ask_price" real,
	"last_price" real,
	"distance_to_target_percent" real,
	"distance_to_stop_percent" real,
	"pnl_at_snapshot" real,
	"delta_at_snapshot" real,
	"iv_at_snapshot" real,
	"data_source" text,
	"validator_version" text,
	"raw_quote_data" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_activity_events" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"session_id" varchar,
	"activity_type" varchar NOT NULL,
	"description" text,
	"metadata" jsonb,
	"occurred_at" timestamp DEFAULT now(),
	"device" varchar
);
--> statement-breakpoint
CREATE TABLE "user_analytics_summary" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"date" varchar NOT NULL,
	"total_sessions" integer DEFAULT 0,
	"total_time_seconds" integer DEFAULT 0,
	"page_views" integer DEFAULT 0,
	"unique_pages" integer DEFAULT 0,
	"ideas_viewed" integer DEFAULT 0,
	"ideas_generated" integer DEFAULT 0,
	"charts_viewed" integer DEFAULT 0,
	"pdfs_exported" integer DEFAULT 0,
	"journal_entries" integer DEFAULT 0,
	"scanners_run" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_login_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"login_at" timestamp DEFAULT now(),
	"ip_address" varchar,
	"user_agent" text,
	"browser" varchar,
	"os" varchar,
	"device" varchar,
	"session_id" varchar,
	"logout_at" timestamp,
	"auth_method" varchar,
	"country" varchar,
	"city" varchar
);
--> statement-breakpoint
CREATE TABLE "user_navigation_layouts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"layout" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "user_navigation_layouts_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "user_page_layouts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"page_id" varchar NOT NULL,
	"layout_name" varchar DEFAULT 'default',
	"widgets" jsonb DEFAULT '[]'::jsonb,
	"columns" integer DEFAULT 12,
	"row_height" integer DEFAULT 60,
	"panel_sizes" jsonb,
	"is_default" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wallet_alerts" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"wallet_id" varchar NOT NULL,
	"transaction_id" varchar,
	"alert_type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"token_symbol" text,
	"amount_usd" real,
	"is_read" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "wallet_holdings" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" varchar NOT NULL,
	"token_address" text,
	"token_symbol" text NOT NULL,
	"token_name" text,
	"balance" real NOT NULL,
	"balance_usd" real,
	"previous_balance" real,
	"change_percent" real,
	"last_updated_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wallet_id" varchar NOT NULL,
	"tx_hash" text NOT NULL,
	"network" text NOT NULL,
	"type" text NOT NULL,
	"token_symbol" text NOT NULL,
	"token_address" text,
	"amount" real NOT NULL,
	"amount_usd" real,
	"from_address" text,
	"to_address" text,
	"block_number" integer,
	"timestamp" text NOT NULL,
	"is_large_transaction" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "watchlist_history" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"watchlist_id" varchar NOT NULL,
	"symbol" text NOT NULL,
	"snapshot_date" text NOT NULL,
	"year" integer NOT NULL,
	"grade_score" real,
	"grade_letter" text,
	"tier" text,
	"confidence_score" real,
	"price" real NOT NULL,
	"price_change" real,
	"volume" real,
	"technical_snapshot" text,
	"has_earnings" boolean DEFAULT false,
	"has_news" boolean DEFAULT false,
	"has_trade" boolean DEFAULT false,
	"has_note" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "whale_flows" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" varchar(20) NOT NULL,
	"option_type" text NOT NULL,
	"strike_price" real NOT NULL,
	"expiry_date" varchar NOT NULL,
	"entry_price" real NOT NULL,
	"target_price" real NOT NULL,
	"stop_loss" real NOT NULL,
	"premium_per_contract" real NOT NULL,
	"is_mega_whale" boolean DEFAULT false,
	"flow_size" varchar,
	"grade" varchar(10),
	"confidence_score" integer,
	"direction" text NOT NULL,
	"detected_at" timestamp DEFAULT now(),
	"outcome_status" text DEFAULT 'open',
	"final_pnl" real,
	"discord_notified" boolean DEFAULT false,
	"trade_idea_id" varchar
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "email" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "status" text DEFAULT 'published' NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "chart_image_url" text;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "chart_analysis_json" jsonb;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "news_bias" text;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "earnings_beat" boolean;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "trade_type" text DEFAULT 'swing';--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "option_delta" real;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "option_theta" real;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "option_gamma" real;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "option_vega" real;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "option_iv" real;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "missed_entry_theoretical_outcome" text;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "missed_entry_theoretical_gain" real;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "research_horizon" text DEFAULT 'intraday';--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "risk_profile" text DEFAULT 'moderate';--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "sector_focus" text;--> statement-breakpoint
ALTER TABLE "trade_ideas" ADD COLUMN "convergence_signals_json" jsonb;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "risk_profile" jsonb DEFAULT '{"tier":"moderate","maxPositionSizePercent":2,"maxDailyLossPercent":5,"maxCorrelatedPositions":3,"requireConfirmation":true}'::jsonb;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "technical_thresholds" jsonb DEFAULT '{"rsi":{"oversold":30,"overbought":70,"weightAdjustment":0,"enabled":true},"adx":{"trendingMinimum":25,"strongTrend":40,"weightAdjustment":0,"enabled":true},"volume":{"surgeRatio":2,"weightAdjustment":0,"enabled":true},"macd":{"crossoverThreshold":0.5,"weightAdjustment":0,"enabled":true},"vwap":{"deviationPercent":1,"weightAdjustment":0,"enabled":true},"bollinger":{"period":20,"stdDev":2,"weightAdjustment":0,"enabled":true}}'::jsonb;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "fundamental_filters" jsonb DEFAULT '{"minMarketCap":1000000000,"maxPeRatio":null,"requireEarningsBeat":false,"insiderBuyingWeight":15,"sectorRotationBias":[],"excludePennyStocks":true,"minAverageVolume":null}'::jsonb;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "layout_density" text DEFAULT 'comfortable';--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "sidebar_collapsed" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "animations_enabled" boolean DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "dashboard_preset" varchar DEFAULT 'default';--> statement-breakpoint
ALTER TABLE "user_preferences" ADD COLUMN "favorite_pages" text[] DEFAULT '{}'::text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_customer_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_subscription_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_price_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "stripe_current_period_end" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "has_beta_access" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "beta_invite_id" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "credits" integer DEFAULT 10 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_credit_refresh" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "login_streak" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "last_login_date" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referred_by" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "total_credits_earned" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "occupation" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trading_experience_level" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "knowledge_focus" text[];--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "investment_goals" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "risk_tolerance" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_source" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "onboarding_completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "category" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "thesis" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "conviction" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "sector" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "start_of_year_price" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "yearly_target_price" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "catalyst_notes" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "review_date" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "current_price" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "price_updated_at" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "ytd_performance" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "grade_score" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "grade_letter" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "tier" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "last_evaluated_at" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "grade_inputs" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "track_premiums" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "preferred_strike" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "preferred_expiry" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "preferred_option_type" text DEFAULT 'call';--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "last_premium" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "last_premium_date" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "premium_alert_threshold" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "avg_premium" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "premium_percentile" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "initial_score" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "initial_tier" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "added_reason" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "price_since_added" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "times_traded" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "times_won" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "total_pnl" real DEFAULT 0;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "avg_return" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "personal_edge_boost" real;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "last_traded_at" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "notes_count" integer DEFAULT 0;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "next_catalyst" text;--> statement-breakpoint
ALTER TABLE "watchlist" ADD COLUMN "next_catalyst_date" text;--> statement-breakpoint
CREATE INDEX "idx_analysis_audit_symbol" ON "analysis_audit_log" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_analysis_audit_timestamp" ON "analysis_audit_log" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_analysis_audit_consumer" ON "analysis_audit_log" USING btree ("consumed_by");--> statement-breakpoint
CREATE INDEX "idx_attention_symbol" ON "attention_events" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_attention_occurred" ON "attention_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "idx_attention_source" ON "attention_events" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_user_id" ON "credit_transactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_credit_transactions_created_at" ON "credit_transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_signal_weights_name" ON "dynamic_signal_weights" USING btree ("signal_name");--> statement-breakpoint
CREATE INDEX "idx_iv_snapshots_symbol_date" ON "iv_snapshots" USING btree ("symbol","date");--> statement-breakpoint
CREATE INDEX "idx_ml_registry_name" ON "ml_model_registry" USING btree ("model_name");--> statement-breakpoint
CREATE INDEX "idx_ml_registry_status" ON "ml_model_registry" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ml_registry_champion" ON "ml_model_registry" USING btree ("is_champion");--> statement-breakpoint
CREATE INDEX "idx_ml_jobs_model" ON "ml_retraining_jobs" USING btree ("model_name");--> statement-breakpoint
CREATE INDEX "idx_ml_jobs_status" ON "ml_retraining_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_ml_training_symbol" ON "ml_training_samples" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_ml_training_engine" ON "ml_training_samples" USING btree ("prediction_engine");--> statement-breakpoint
CREATE INDEX "idx_ml_training_outcome" ON "ml_training_samples" USING btree ("outcome_status");--> statement-breakpoint
CREATE INDEX "idx_ml_training_usable" ON "ml_training_samples" USING btree ("is_usable_for_training");--> statement-breakpoint
CREATE INDEX "idx_ml_training_predicted_at" ON "ml_training_samples" USING btree ("predicted_at");--> statement-breakpoint
CREATE INDEX "idx_pattern_symbol" ON "pattern_signals" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_pattern_type" ON "pattern_signals" USING btree ("pattern_type");--> statement-breakpoint
CREATE INDEX "idx_pattern_status" ON "pattern_signals" USING btree ("pattern_status");--> statement-breakpoint
CREATE INDEX "idx_pattern_score" ON "pattern_signals" USING btree ("pattern_score");--> statement-breakpoint
CREATE INDEX "idx_pattern_active" ON "pattern_signals" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "idx_heat_symbol" ON "symbol_heat_scores" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_heat_score" ON "symbol_heat_scores" USING btree ("heat_score");--> statement-breakpoint
CREATE INDEX "idx_whale_flows_symbol" ON "whale_flows" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_whale_flows_detected_at" ON "whale_flows" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "idx_whale_flows_is_mega" ON "whale_flows" USING btree ("is_mega_whale");--> statement-breakpoint
CREATE INDEX "idx_whale_flows_status" ON "whale_flows" USING btree ("outcome_status");--> statement-breakpoint
CREATE INDEX "idx_trade_ideas_timestamp" ON "trade_ideas" USING btree ("timestamp");--> statement-breakpoint
CREATE INDEX "idx_trade_ideas_outcome_status" ON "trade_ideas" USING btree ("outcome_status");--> statement-breakpoint
CREATE INDEX "idx_trade_ideas_expiry_date" ON "trade_ideas" USING btree ("expiry_date");--> statement-breakpoint
CREATE INDEX "idx_trade_ideas_source" ON "trade_ideas" USING btree ("source");--> statement-breakpoint
CREATE INDEX "idx_trade_ideas_symbol" ON "trade_ideas" USING btree ("symbol");--> statement-breakpoint
CREATE INDEX "idx_trade_ideas_user_id" ON "trade_ideas" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_trade_ideas_entry_valid" ON "trade_ideas" USING btree ("entry_valid_until");--> statement-breakpoint
CREATE INDEX "idx_trade_ideas_status_timestamp" ON "trade_ideas" USING btree ("outcome_status","timestamp");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");