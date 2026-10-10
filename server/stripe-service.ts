import Stripe from 'stripe';
import { db } from './db';
import { users, type SubscriptionTier } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { logger } from './logger';

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
const stripeEnabled = !!STRIPE_SECRET_KEY;

let stripe: Stripe | null = null;
if (stripeEnabled) {
  stripe = new Stripe(STRIPE_SECRET_KEY, {
    apiVersion: '2025-04-30.basil',
  });
  logger.info('Stripe initialized successfully');
} else {
  logger.warn('STRIPE_SECRET_KEY not configured - billing features disabled');
}

export interface PricingPlan {
  id: string;
  name: string;
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  stripePriceIdMonthly: string | null;
  stripePriceIdYearly: string | null;
  tier: SubscriptionTier;
  features: string[];
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    description: 'Explore the research platform risk-free',
    monthlyPrice: 0,
    yearlyPrice: 0,
    stripePriceIdMonthly: null,
    stripePriceIdYearly: null,
    tier: 'free',
    features: [
      '5 research briefs per day',
      'Delayed market data (15min)',
      '7-day performance history',
      'Stocks & crypto only',
      '3 watchlist items',
    ],
  },
  {
    id: 'advanced',
    name: 'Advanced',
    description: 'Full stock & crypto access for serious traders',
    monthlyPrice: 39,
    yearlyPrice: 349,
    stripePriceIdMonthly: process.env.STRIPE_PRICE_ADVANCED_MONTHLY || '',
    stripePriceIdYearly: process.env.STRIPE_PRICE_ADVANCED_YEARLY || '',
    tier: 'advanced',
    features: [
      'Unlimited research briefs',
      'Real-time market data',
      'Unlimited chart analyses',
      'Unlimited AI generations',
      'Full performance history',
      'Discord alerts',
      'Advanced analytics',
      'Export data',
      '50 watchlist items',
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'For power users who need institutional-grade tools',
    monthlyPrice: 79,
    yearlyPrice: 699,
    stripePriceIdMonthly: process.env.STRIPE_PRICE_PRO_MONTHLY || '',
    stripePriceIdYearly: process.env.STRIPE_PRICE_PRO_YEARLY || '',
    tier: 'pro',
    features: [
      'Everything in Advanced',
      'Futures trading (NQ, ES, GC)',
      'REST API access',
      'White-label PDF reports',
      'Pattern Scanner module',
      'Custom webhooks (Slack, Telegram)',
      'Portfolio correlation analytics',
      'Priority idea generation',
      '1-on-1 onboarding call',
      'Private Discord channel',
    ],
  },
];

export async function createCheckoutSession(
  userId: string,
  userEmail: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string
): Promise<{ url: string | null; error?: string }> {
  if (!stripe) {
    return { url: null, error: 'Stripe is not configured. Please contact support.' };
  }

  try {
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    
    if (!user.length) {
      return { url: null, error: 'User not found' };
    }

    let customerId = user[0].stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: userEmail,
        metadata: {
          userId: userId,
        },
      });
      customerId = customer.id;

      await db.update(users)
        .set({ stripeCustomerId: customerId })
        .where(eq(users.id, userId));
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId: userId,
      },
      subscription_data: {
        metadata: {
          userId: userId,
        },
      },
    });

    return { url: session.url };
  } catch (error) {
    logger.error('Failed to create checkout session', { error });
    return { url: null, error: 'Failed to create checkout session' };
  }
}

export async function createPortalSession(
  userId: string,
  returnUrl: string
): Promise<{ url: string | null; error?: string }> {
  if (!stripe) {
    return { url: null, error: 'Stripe is not configured. Please contact support.' };
  }

  try {
    const user = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    
    if (!user.length || !user[0].stripeCustomerId) {
      return { url: null, error: 'No subscription found' };
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user[0].stripeCustomerId,
      return_url: returnUrl,
    });

    return { url: session.url };
  } catch (error) {
    logger.error('Failed to create portal session', { error });
    return { url: null, error: 'Failed to create portal session' };
  }
}

export function getTierFromPriceId(priceId: string): SubscriptionTier {
  for (const plan of PRICING_PLANS) {
    if (plan.stripePriceIdMonthly === priceId || plan.stripePriceIdYearly === priceId) {
      return plan.tier;
    }
  }
  return 'free';
}

export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  if (!stripe) {
    logger.error('Cannot handle webhook - Stripe not configured');
    return;
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.metadata?.userId;
      
      if (userId && session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(session.subscription as string);
        const priceId = subscription.items.data[0]?.price.id;
        const tier = getTierFromPriceId(priceId);

        await db.update(users)
          .set({
            subscriptionTier: tier,
            subscriptionStatus: 'active',
            stripeSubscriptionId: subscription.id,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
            updatedAt: new Date(),
          })
          .where(eq(users.id, userId));

        logger.info('Subscription activated', { userId, tier, subscriptionId: subscription.id });
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      
      const user = await db.select().from(users).where(eq(users.stripeCustomerId, customerId)).limit(1);
      
      if (user.length) {
        const priceId = subscription.items.data[0]?.price.id;
        const tier = getTierFromPriceId(priceId);
        const status = subscription.status === 'active' ? 'active' : 
                      subscription.status === 'past_due' ? 'past_due' : 'canceled';

        await db.update(users)
          .set({
            subscriptionTier: tier,
            subscriptionStatus: status,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: new Date(subscription.current_period_end * 1000),
            updatedAt: new Date(),
          })
          .where(eq(users.id, user[0].id));

        logger.info('Subscription updated', { userId: user[0].id, tier, status });
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object as Stripe.Subscription;
      const customerId = subscription.customer as string;
      
      const user = await db.select().from(users).where(eq(users.stripeCustomerId, customerId)).limit(1);
      
      if (user.length) {
        await db.update(users)
          .set({
            subscriptionTier: 'free',
            subscriptionStatus: 'canceled',
            stripeSubscriptionId: null,
            stripePriceId: null,
            stripeCurrentPeriodEnd: null,
            updatedAt: new Date(),
          })
          .where(eq(users.id, user[0].id));

        logger.info('Subscription canceled', { userId: user[0].id });
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object as Stripe.Invoice;
      const customerId = invoice.customer as string;
      
      const user = await db.select().from(users).where(eq(users.stripeCustomerId, customerId)).limit(1);
      
      if (user.length) {
        await db.update(users)
          .set({
            subscriptionStatus: 'past_due',
            updatedAt: new Date(),
          })
          .where(eq(users.id, user[0].id));

        logger.warn('Payment failed', { userId: user[0].id });
      }
      break;
    }
  }
}

export function constructWebhookEvent(
  payload: string | Buffer,
  signature: string,
  webhookSecret: string
): Stripe.Event {
  if (!stripe) {
    throw new Error('Stripe is not configured');
  }
  return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}

export { stripe, stripeEnabled };
