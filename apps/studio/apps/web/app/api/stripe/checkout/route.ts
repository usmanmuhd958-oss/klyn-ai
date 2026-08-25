import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe/client";

interface CheckoutRequest {
  workspaceId: string;
  priceId: string;
  customerEmail?: string;
}

function validateRequest(body: unknown): body is CheckoutRequest {
  if (typeof body !== "object" || body === null) {
    return false;
  }

  const data = body as Record<string, unknown>;

  return (
    typeof data.workspaceId === "string" &&
    typeof data.priceId === "string"
  );
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (!validateRequest(body)) {
      return NextResponse.json(
        { error: "Invalid checkout payload" },
        { status: 400 }
      );
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [
        {
          price: body.priceId,
          quantity: 1,
        },
      ],
      customer_email: body.customerEmail,
      metadata: {
        workspaceId: body.workspaceId,
      },
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/billing/cancel`,
    });

    return NextResponse.json({
      checkoutUrl: session.url,
    });
  } catch (error) {
    console.error("Stripe checkout failed", error);

    return NextResponse.json(
      { error: "Unable to create checkout session" },
      { status: 500 }
    );
  }
}
