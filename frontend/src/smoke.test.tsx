import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

function Hello() {
	return <div>Hello Orbital</div>;
}

describe("test harness smoke", () => {
	it("renders a component into jsdom", () => {
		render(<Hello />);
		expect(screen.getByText("Hello Orbital")).toBeTruthy();
	});
});
