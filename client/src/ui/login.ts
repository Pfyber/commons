// Sign-in overlay: magic link by email, then a one-time sign-up step (name +
// birth year age gate). In dev builds a quick name-only login is offered.

import { ApiError, type Auth } from "../net/api";

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Record<string, unknown> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  Object.assign(e, props);
  e.append(...children);
  return e;
}

function card(root: HTMLElement, ...children: Node[]) {
  root.replaceChildren(el("div", { className: "card" }, ...children));
  root.hidden = false;
}

function errorLine() {
  return el("p", { className: "error", role: "alert" });
}

function message(e: unknown): string {
  return e instanceof ApiError ? e.message : "Something went wrong. Please try again.";
}

const header = () => [
  el("h1", {}, "Commons"),
  el("p", { className: "tagline" }, "A calm park-town. No feed, no ads. The people here decide what comes next."),
];

/** Shows the sign-in flow until the user has a session. */
export function signIn(root: HTMLElement, auth: Auth): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      root.hidden = true;
      root.replaceChildren();
      resolve();
    };

    const params = new URLSearchParams(location.search);
    const loginToken = params.get("login");
    if (loginToken) {
      history.replaceState(null, "", location.pathname);
      verifying(loginToken);
    } else {
      emailStep();
    }

    function emailStep() {
      const err = errorLine();
      const email = el("input", { type: "email", placeholder: "you@example.org", required: true, autocomplete: "email" });
      const submit = el("button", { type: "submit", className: "primary" }, "Send me a sign-in link");
      const form = el("form", {}, el("label", {}, "Email", email), submit, err);
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        submit.disabled = true;
        err.textContent = "";
        try {
          const res = await auth.requestLink(email.value);
          linkSent(email.value, res.dev_link);
        } catch (e) {
          err.textContent = message(e);
          submit.disabled = false;
        }
      };
      const parts: Node[] = [...header(), form];
      if (import.meta.env.DEV) parts.push(devLogin());
      card(root, ...parts);
      email.focus();
    }

    function devLogin() {
      const err = errorLine();
      const name = el("input", { placeholder: "Any name", maxLength: 20, autocomplete: "nickname" });
      const go = el("button", { type: "submit" }, "Enter");
      const form = el("form", { className: "dev" }, el("label", {}, "Dev quick login", el("div", { className: "row" }, name, go)), err);
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        go.disabled = true;
        try {
          await auth.devLogin(name.value);
          done();
        } catch (e) {
          err.textContent = message(e);
          go.disabled = false;
        }
      };
      return form;
    }

    function linkSent(email: string, devLink?: string) {
      const parts: Node[] = [
        ...header(),
        el("p", {}, "Check your inbox at ", el("strong", {}, email), ". The link works once and expires in 15 minutes."),
      ];
      if (devLink) {
        parts.push(el("a", { href: devLink, className: "button primary" }, "Open sign-in link (dev)"));
      }
      const back = el("button", { type: "button", className: "link" }, "Use a different email");
      back.onclick = emailStep;
      parts.push(back);
      card(root, ...parts);
    }

    async function verifying(token: string) {
      card(root, ...header(), el("p", {}, "Signing you in…"));
      try {
        const signup = await auth.verify(token);
        if (signup) signupStep(signup.signup_token, signup.email);
        else done();
      } catch (e) {
        const err = errorLine();
        err.textContent = message(e);
        const again = el("button", { type: "button", className: "primary" }, "Request a new link");
        again.onclick = emailStep;
        card(root, ...header(), err, again);
      }
    }

    function signupStep(signupToken: string, email: string) {
      const err = errorLine();
      const name = el("input", { required: true, minLength: 3, maxLength: 20, placeholder: "How others will see you", autocomplete: "nickname" });
      const year = el("select", { required: true });
      const now = new Date().getFullYear();
      year.append(el("option", { value: "", disabled: true, selected: true }, "Year"));
      for (let y = now; y >= now - 100; y--) year.append(el("option", { value: String(y) }, String(y)));
      const submit = el("button", { type: "submit", className: "primary" }, "Join the park");
      const form = el(
        "form",
        {},
        el("p", {}, "Welcome! Creating an account for ", el("strong", {}, email), "."),
        el("label", {}, "Display name", name),
        el("label", {}, "Birth year", year),
        el("p", { className: "fine" }, "Commons is for ages 13+. Your birth year is private and only used for age-appropriate settings."),
        submit,
        err,
      );
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        submit.disabled = true;
        err.textContent = "";
        try {
          await auth.signup(signupToken, name.value, Number(year.value));
          done();
        } catch (e) {
          err.textContent = message(e);
          submit.disabled = false;
        }
      };
      card(root, ...header(), form);
      name.focus();
    }
  });
}
