export type Market = {
    id: number;
    song: string;
    artist: string;
    category: string;
    chance: number;
    change: number;
    rank: number;
    volume: string;
    color: string;
    monogram: string;
    question: string;
    tag?: string;
};
// Illustrative fixtures until the market and chart APIs are available.
export const markets: Market[] = [
    { id: 1, song: "Housewife", artist: "Tate McRae", category: "Pop", chance: 68, change: 8, rank: 12, volume: "32,248", color: "rose", monogram: "TM", question: "Will Housewife climb the Hot 100 this week?", tag: "Crowd favorite" },
    { id: 2, song: "Choosin’ Texas", artist: "Ella Langley", category: "Country", chance: 82, change: 12, rank: 3, volume: "24,810", color: "sand", monogram: "EL", question: "Will Choosin’ Texas reach the top spot?", tag: "Heating up" },
    { id: 3, song: "The Fate of Ophelia", artist: "Taylor Swift", category: "Pop", chance: 76, change: 5, rank: 1, volume: "48,620", color: "blue", monogram: "TS", question: "Will The Fate of Ophelia hold at #1?" },
    { id: 4, song: "Man I Need", artist: "Olivia Dean", category: "R&B / Soul", chance: 61, change: 6, rank: 8, volume: "18,450", color: "olive", monogram: "OD", question: "Will Man I Need break into the top 5?" },
    { id: 5, song: "Golden", artist: "HUNTR/X", category: "Pop", chance: 43, change: -4, rank: 5, volume: "29,304", color: "violet", monogram: "HX", question: "Will Golden rise on next week’s chart?" },
    { id: 6, song: "Ordinary", artist: "Alex Warren", category: "Pop", chance: 57, change: 3, rank: 9, volume: "16,780", color: "rust", monogram: "AW", question: "Will Ordinary stay in the top 10?" },
];
