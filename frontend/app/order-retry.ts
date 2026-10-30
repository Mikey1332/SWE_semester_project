import type { TradeAction, TradeSide } from "./trading";

export type UnfinishedOrder = {
    user_id: string;
    market_id: number;
    request_id: string;
    side: TradeSide;
    action: TradeAction;
    price: number;
    quantity: number;
};

export function saveUnfinishedOrder(storage: Storage, order: UnfinishedOrder) {
    const key = "octave-order-" + order.user_id + "-" + order.request_id;
    storage.setItem(key, JSON.stringify(order));
}

export function removeUnfinishedOrder(storage: Storage, order: UnfinishedOrder) {
    const key = "octave-order-" + order.user_id + "-" + order.request_id;
    storage.removeItem(key);
}

export function readUnfinishedOrders(storage: Storage, userID: string): UnfinishedOrder[] {
    const prefix = "octave-order-" + userID + "-";
    const orders: UnfinishedOrder[] = [];
    for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (key && key.startsWith(prefix)) {
            const text = storage.getItem(key);
            if (text) {
                orders.push(JSON.parse(text) as UnfinishedOrder);
            }
        }
    }
    return orders;
}
