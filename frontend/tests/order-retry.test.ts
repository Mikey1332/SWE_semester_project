import { describe, expect, it } from "vitest";
import { readUnfinishedOrders, removeUnfinishedOrder, saveUnfinishedOrder, type UnfinishedOrder } from "../app/order-retry";

class TestStorage implements Storage {
    private values = new Map<string, string>();

    get length() { return this.values.size; }
    clear() { this.values.clear(); }
    getItem(key: string) { return this.values.get(key) ?? null; }
    key(index: number) { return Array.from(this.values.keys())[index] ?? null; }
    removeItem(key: string) { this.values.delete(key); }
    setItem(key: string, value: string) { this.values.set(key, value); }
}

describe("unfinished orders", () => {
    it("keeps separate requests until each one is resolved", () => {
        const storage = new TestStorage();
        const first: UnfinishedOrder = {
            user_id: "jack", market_id: 1, request_id: "first",
            side: "yes", action: "sell", price: 50, quantity: 3,
        };
        const second = { ...first, request_id: "second" };
        const otherUser = { ...first, user_id: "other" };

        saveUnfinishedOrder(storage, first);
        saveUnfinishedOrder(storage, second);
        saveUnfinishedOrder(storage, otherUser);
        expect(readUnfinishedOrders(storage, "jack")).toEqual([first, second]);

        saveUnfinishedOrder(storage, first);
        expect(readUnfinishedOrders(storage, "jack")).toEqual([first, second]);
        removeUnfinishedOrder(storage, first);
        expect(readUnfinishedOrders(storage, "jack")).toEqual([second]);
        expect(readUnfinishedOrders(storage, "other")).toEqual([otherUser]);
    });
});
