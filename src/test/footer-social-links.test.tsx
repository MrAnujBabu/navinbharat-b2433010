import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import Footer from "@/components/Landing/Footer";
import { TELEGRAM_URL, YOUTUBE_URL } from "@/config/socialLinks";

describe("landing footer social links", () => {
  it("renders working YouTube and Telegram links without dead image assets", () => {
    const { container } = render(
      <MemoryRouter>
        <Footer />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: /YouTube/i })).toHaveAttribute(
      "href",
      YOUTUBE_URL,
    );
    expect(screen.getByRole("link", { name: /Telegram/i })).toHaveAttribute(
      "href",
      TELEGRAM_URL,
    );
    expect(container.querySelectorAll('img[src*="/__l5e/assets-v1/"]')).toHaveLength(0);
  });

  it("uses the current Naveen Bharat Telegram handle", () => {
    expect(TELEGRAM_URL).toBe("https://t.me/Naveenbharat1");
  });
});
