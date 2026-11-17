import { refreshCredits } from "../credits.js";
import { h, api, timeAgo } from "../ui.js";
import { icon } from "../icons.js";

const credits = (n) =>
  new Intl.NumberFormat("en-NG", { maximumFractionDigits: 4 }).format(n);
const money = (kobo) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 2,
  }).format(kobo / 100);
const statusLabel = (s) =>
  ({
    paid: "Credits added",
    pending: "Awaiting confirmation",
    failed: "Not completed",
    review: "Needs review",
  })[s] || s;

export async function mount(view) {
  let alive = true;
  let quoteTimer;
  let quoteVersion = 0;
  let buying = false;
  let wallet = await api("/api/wallet");
  const page = h("div", { class: "wallet-page" });
  const message = h("p", {
    class: "small",
    role: "status",
    "aria-live": "polite",
  });
  const balance = h("strong", { class: "wallet-balance" });
  const amount = h("input", {
    class: "input",
    id: "wallet-credits",
    type: "number",
    min: "1",
    step: "1",
    value: "30",
    inputmode: "numeric",
    required: true,
    autocomplete: "off",
  });
  const price = h("p", { class: "wallet-price", "aria-live": "polite" });
  const checkout = h(
    "button",
    { class: "btn primary", type: "submit" },
    h("span", { html: icon("lock", { size: 16 }) }),
    "Purchase",
  );
  const choices = h("div", {
    class: "wallet-bundles",
    role: "group",
    "aria-label": "Credit bundles",
  });
  const payments = h("div", { class: "wallet-list" });
  const entries = h("div", { class: "wallet-list" });
  const olderPurchases = h(
    "button",
    { class: "btn sm", type: "button", hidden: true },
    "Load older purchases",
  );
  let purchaseCursor = null;
  const more = h(
    "button",
    { class: "btn sm", type: "button", hidden: true },
    "Load older transactions",
  );
  let cursor = null;
  const notify = (text, error = false) => {
    if (!alive) return;
    message.textContent = text;
    message.classList.toggle("wallet-error", error);
  };
  function renderBalance() {
    balance.textContent = credits(wallet.balanceCredits) + " credits";
    checkout.disabled = !wallet.purchasesEnabled || buying;
  }
  function renderEntries(list, append = false) {
    if (!append) entries.replaceChildren();
    if (!list.length && !append)
      entries.append(
        h(
          "p",
          { class: "small muted" },
          "No credit transactions yet. Completed purchases will appear here.",
        ),
      );
    for (const entry of list)
      entries.append(
        h(
          "div",
          { class: "wallet-item" },
          h(
            "div",
            null,
            h(
              "strong",
              null,
              entry.type === "usage" ? "Meeting usage" : "Credit purchase",
            ),
            h("div", { class: "tiny muted" }, timeAgo(entry.createdAt)),
          ),
          h(
            "div",
            { class: "wallet-value" },
            h(
              "strong",
              null,
              (entry.credits > 0 ? "+" : "") + credits(entry.credits),
            ),
            h(
              "div",
              { class: "tiny muted" },
              credits(entry.balanceAfter) + " balance",
            ),
          ),
        ),
      );
  }
  async function refresh() {
    const [summary, purchases, ledger] = await Promise.all([
      api("/api/wallet"),
      api("/api/wallet/payments"),
      api("/api/wallet/transactions"),
    ]);
    if (!alive) return;
    wallet = summary;
    renderBalance();
    refreshCredits();
    renderEntries(ledger.entries);
    cursor = ledger.nextBefore;
    more.hidden = !cursor;
    renderPurchases(purchases);
  }
  function renderPurchases(purchases, append = false) {
    purchaseCursor = purchases.nextBefore;
    olderPurchases.hidden = !purchaseCursor;
    if (!append) payments.replaceChildren();
    if (!purchases.payments.length && !append)
      payments.append(
        h("p", { class: "small muted" }, "No purchases started yet."),
      );
    for (const payment of purchases.payments) {
      const check = h(
        "button",
        {
          class: "btn sm",
          type: "button",
          onclick: async () => {
            check.disabled = true;
            try {
              await checkPayment(payment.reference);
            } catch (e) {
              notify(e.message, true);
            } finally {
              if (alive) check.disabled = false;
            }
          },
        },
        "Check payment",
      );
      payments.append(
        h(
          "div",
          { class: "wallet-item" },
          h(
            "div",
            { class: "grow" },
            h("strong", null, credits(payment.credits) + " credits"),
            h(
              "div",
              { class: "tiny muted" },
              money(payment.priceKobo) +
                " + processing fee · " +
                timeAgo(payment.createdAt),
            ),
            h("div", { class: "tiny" }, statusLabel(payment.status)),
          ),
          payment.status !== "paid"
            ? h(
                "div",
                { class: "wallet-actions" },
                payment.status === "pending" && payment.authorizationUrl
                  ? h(
                      "a",
                      { class: "btn sm", href: payment.authorizationUrl },
                      "Open checkout",
                    )
                  : null,
                check,
              )
            : h("span", { class: "chip" }, "Complete"),
        ),
      );
    }
  }
  async function checkPayment(reference) {
    notify("Checking your payment…");
    const result = await api(
      `/api/wallet/payments/${encodeURIComponent(reference)}/verify`,
      { method: "POST" },
    );
    if (!alive) return;
    notify(
      result.status === "paid"
        ? "Payment confirmed. Your credits are available."
        : result.status === "pending"
          ? "Payment is still pending. You can check again from your purchases."
          : "This payment was not completed. You can start another purchase.",
    );
    await refresh();
  }
  async function updateQuote() {
    const version = ++quoteVersion;
    const count = Number(amount.value);
    for (const b of choices.children)
      b.setAttribute(
        "aria-pressed",
        String(Number(b.dataset.credits) === count),
      );
    checkout.disabled = true;
    if (!Number.isSafeInteger(count) || count < 1) {
      price.textContent = "Enter a positive whole number of credits.";
      return;
    }
    try {
      const result = await api("/api/wallet/quote", {
        method: "POST",
        body: { credits: count },
      });
      if (!alive || version !== quoteVersion) return;
      price.textContent =
        money(result.priceKobo) + " + Paystack processing fee";
      checkout.disabled = !wallet.purchasesEnabled || buying;
    } catch (e) {
      if (alive && version === quoteVersion) price.textContent = e.message;
    }
  }
  for (const bundle of wallet.bundles)
    choices.append(
      h(
        "button",
        {
          type: "button",
          class: "wallet-bundle",
          dataset: { credits: bundle.credits },
          "aria-pressed": bundle.credits === 30 ? "true" : "false",
          onclick: () => {
            amount.value = bundle.credits;
            clearTimeout(quoteTimer);
            updateQuote();
          },
        },
        h("strong", null, credits(bundle.credits) + " credits"),
        h("span", { class: "small muted" }, money(bundle.priceKobo)),
      ),
    );
  amount.oninput = () => {
    checkout.disabled = true;
    quoteVersion++;
    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(updateQuote, 250);
  };
  const form = h(
    "form",
    {
      class: "col",
      style: { gap: ".8rem" },
      onsubmit: async (event) => {
        event.preventDefault();
        if (buying || !wallet.purchasesEnabled) return;
        buying = true;
        checkout.disabled = true;
        amount.disabled = true;
        for (const choice of choices.children) choice.disabled = true;
        notify("Opening secure checkout…");
        try {
          const result = await api("/api/wallet/checkout", {
            method: "POST",
            body: { credits: Number(amount.value) },
          });
          if (alive) location.assign(result.authorizationUrl);
        } catch (e) {
          notify(
            e.message +
              " If you completed a payment, check it below before buying again.",
            true,
          );
          await refresh().catch(() => {});
        } finally {
          buying = false;
          if (alive) {
            amount.disabled = false;
            for (const choice of choices.children) choice.disabled = false;
            updateQuote();
          }
        }
      },
    },
    choices,
    h(
      "label",
      { class: "field", for: "wallet-credits" },
      h("span", { class: "lbl" }, "Or choose a custom number of credits"),
      amount,
    ),
    price,
    // h(
    //   "p",
    //   { class: "tiny muted" },
    //   "Paystack shows the final processing fee before you pay. Fees do not buy extra credits.",
    // ),
    checkout,
  );
  olderPurchases.onclick = async () => {
    olderPurchases.disabled = true;
    try {
      const page = await api(
        "/api/wallet/payments?before=" + encodeURIComponent(purchaseCursor),
      );
      if (alive) renderPurchases(page, true);
    } catch (e) {
      notify(e.message, true);
    } finally {
      olderPurchases.disabled = false;
    }
  };
  more.onclick = async () => {
    more.disabled = true;
    try {
      const ledger = await api(
        "/api/wallet/transactions?before=" + encodeURIComponent(cursor),
      );
      if (alive) {
        renderEntries(ledger.entries, true);
        cursor = ledger.nextBefore;
        more.hidden = !cursor;
      }
    } catch (e) {
      notify(e.message, true);
    } finally {
      more.disabled = false;
    }
  };
  page.append(
    h(
      "div",
      { class: "page-head" },
      h("h1", { html: icon("creditCard", { size: 26 }) + "Credit wallet" }),
      h(
        "p",
        { class: "muted" },
        "₦500 per credit. Purchased credits never expire.",
      ),
    ),
    h(
      "section",
      { class: "card pad wallet-summary", "aria-label": "Credit balance" },
      h("span", { class: "small muted" }, "Available balance"),
      balance,
    ),
    message,
    h("section", { class: "card pad" }, h("h2", null, "Buy credits"), form),
    h(
      "section",
      { class: "card pad" },
      h("h2", null, "Your purchases"),
      payments,
      olderPurchases,
    ),
    h(
      "section",
      { class: "card pad" },
      h("h2", null, "Credit history"),
      entries,
      more,
    ),
  );
  view.append(page);
  renderBalance();
  await refresh();
  await updateQuote();
  const reference =
    new URLSearchParams(location.search).get("reference") ||
    new URLSearchParams(location.search).get("trxref");
  if (reference && /^[A-Za-z0-9-]{1,80}$/.test(reference)) {
    try {
      await checkPayment(reference);
    } catch (e) {
      notify(e.message, true);
    }
  }
  return {
    unmount() {
      alive = false;
      quoteVersion++;
      clearTimeout(quoteTimer);
    },
  };
}
