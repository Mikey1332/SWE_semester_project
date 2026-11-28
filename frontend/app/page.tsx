"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import type { User } from "firebase/auth";
import {
  Clock,
  Music,
  Pause,
  Play,
  Search,
  Star,
  User as UserIcon,
} from "lucide-react";
import { AuthDialog, useOctaveUser } from "./auth-dialog";
import { GroupsView } from "./groups";
import { auth } from "./firebase";
import {
  readUnfinishedOrders,
  removeUnfinishedOrder,
  saveUnfinishedOrder,
  type UnfinishedOrder,
} from "./order-retry";
import OrderBook from "./order-book";
import {
  MARKET_FILTERS,
  MARKET_SORTS,
  artworkColor,
  held,
  lastMove,
  marketQuestion,
  matchesFilter,
  parseQuantity,
  rankPath,
  sidePrice,
  sideLabel,
  sortMarkets,
  type Account,
  type LiveMarket,
  type MarketFilter,
  type MarketSort,
  type TradeAction,
  type TradeSide,
} from "./trading";
import { Tutorial } from "./tutorial-dialog";
import { ProfileView } from "./profile";
import { LeaderboardView } from "./leaderboard";

type PendingOrder = {
  id: number;
  market_id: number;
  side: TradeSide;
  action: TradeAction;
  price: number;
  quantity: number;
  remaining: number;
  cancelled: boolean;
};

type AppleSongInfo = {
  artworkUrl: string;
  albumName: string;
  genre: string;
  releaseDate: string;
  previewUrl: string;
  appleMusicUrl: string;
};

const ARTWORK_PALETTE: Record<string, string> = {
  rose: "bg-[#b98a85] text-[#f3e7ce]",
  sand: "bg-[#c7ac7b] text-[#f5ead5]",
  blue: "bg-[#8b9ea0] text-[#e0e5e5]",
  olive: "bg-[#7c8669] text-[#e5ddc0]",
  violet: "bg-[#ada0cb] text-[#f9eeff]",
  rust: "bg-[#b07f5c] text-[#f7dfc6]",
};

const primaryBtn =
  "inline-flex items-center justify-between gap-[25px] rounded-[7px] border border-ink-strong bg-ink-strong px-[22px] py-[15px] text-[13px] font-semibold text-white hover:bg-[#414b40]";
const textBtn = "inline-flex items-center gap-[9px] py-2 text-[12px]";
const navBtnBase =
  "relative h-full p-0 text-[13px] text-[#60645a] max-[850px]:shrink-0 max-[850px]:text-[11px] max-[580px]:text-[10px]";
const navBtnActive =
  "!text-[#292b26] font-semibold after:absolute after:bottom-0 after:left-0 after:right-0 after:h-[3px] after:bg-[#9480b2] after:content-['']";
const sampleBadge =
  "whitespace-nowrap rounded-[4px] bg-surface-soft px-[7px] py-[5px] text-[9px] text-[#898778] max-[580px]:text-[8px]";

const appleSongCache = new Map<string, Promise<AppleSongInfo | null>>();
const appleQueue: Array<() => void> = [];
let appleInFlight = 0;

function enqueueAppleFetch<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      appleInFlight++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          appleInFlight--;
          appleQueue.shift()?.();
        });
    };
    if (appleInFlight < 4) run();
    else appleQueue.push(run);
  });
}

function getAppleSongInfo(
  title: string,
  artist: string,
): Promise<AppleSongInfo | null> {
  const key = `${title}\0${artist}`.toLowerCase();
  const cached = appleSongCache.get(key);
  if (cached) return cached;

  const promise = enqueueAppleFetch(async () => {
    try {
      const query = encodeURIComponent(title + " " + artist);
      const response = await fetch(
        `https://itunes.apple.com/search?term=${query}&entity=song&limit=1`,
      );
      if (!response.ok) return null;
      const data = await response.json();
      const track = data.results?.[0];
      if (!track) return null;
      const releaseDate = track.releaseDate
        ? new Date(track.releaseDate).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })
        : "";
      return {
        artworkUrl: track.artworkUrl100
          ? String(track.artworkUrl100).replace("100x100bb", "300x300bb")
          : "",
        albumName: track.collectionName || "",
        genre: track.primaryGenreName || "",
        releaseDate,
        previewUrl: track.previewUrl || "",
        appleMusicUrl: track.trackViewUrl || "",
      };
    } catch {
      return null;
    }
  });
  appleSongCache.set(key, promise);
  return promise;
}

function Artwork({
  market,
  className = "h-[57px] w-[53px] rounded-[4px] max-[1150px]:h-[49px] max-[1150px]:w-[44px] max-[850px]:h-[57px] max-[850px]:w-[53px]",
}: {
  market: LiveMarket;
  className?: string;
}) {
  const [coverUrl, setCoverUrl] = useState("");

  useEffect(() => {
    let current = true;
    void getAppleSongInfo(market.title, market.artist).then((info) => {
      if (current) setCoverUrl(info?.artworkUrl ?? "");
    });
    return () => {
      current = false;
    };
  }, [market.title, market.artist]);

  return (
    <div
      className={`relative shrink-0 overflow-hidden ${ARTWORK_PALETTE[artworkColor(market.id)] ?? ARTWORK_PALETTE.rose} ${className}`}
      aria-label={`${market.artist} album artwork`}
    >
      {coverUrl !== "" && (
        <Image
          src={coverUrl}
          alt={market.title}
          width={300}
          height={300}
          unoptimized
          className="block h-full w-full object-cover"
        />
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  const wholeSeconds = Math.floor(seconds);
  const mins = Math.floor(wholeSeconds / 60);
  const secs = wholeSeconds % 60;
  if (secs < 10) {
    return mins + ":0" + secs;
  }
  return mins + ":" + secs;
}

function SongPreview({ market }: { market: LiveMarket }) {
  const [songInfo, setSongInfo] = useState<AppleSongInfo | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(30);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let current = true;
    void getAppleSongInfo(market.title, market.artist).then((info) => {
      if (!current) return;
      setPlaying(false);
      setCurrentTime(0);
      setDuration(30);
      setSongInfo(info);
    });
    return () => {
      current = false;
    };
  }, [market.title, market.artist]);

  if (!songInfo || songInfo.previewUrl === "") {
    return null;
  }

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.muted = false;
    audio.volume = 1;
    if (audio.paused) {
      audio.play().catch(() => {
        setPlaying(false);
      });
    } else {
      audio.pause();
    }
  }

  let progressPercent = 0;
  if (duration > 0) {
    progressPercent = Math.min(100, (currentTime / duration) * 100);
  }

  return (
    <div className="mt-5 flex items-center justify-between gap-5 rounded-[9px] border border-line bg-bg px-4 py-3">
      <audio
        ref={audioRef}
        src={songInfo.previewUrl}
        preload="auto"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={() => {
          if (audioRef.current) {
            setCurrentTime(audioRef.current.currentTime);
          }
        }}
        onLoadedMetadata={() => {
          if (audioRef.current && audioRef.current.duration) {
            setDuration(audioRef.current.duration);
          }
        }}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(0);
        }}
      />

      <div className="flex min-w-[240px] max-w-[380px] items-center gap-3">
        <Artwork market={market} className="h-[52px] w-[52px] rounded-[6px]" />
        <div className="flex min-w-0 flex-col gap-[3px]">
          <strong className="max-w-[310px] truncate text-[13px]">
            {market.title}
          </strong>
          <span className="max-w-[310px] truncate text-[11px] text-muted">
            {market.artist}
          </span>
          <div className="mt-[2px] flex flex-wrap gap-x-[10px] gap-y-1">
            {songInfo.albumName !== "" && (
              <span className="text-[10px] text-[#60645a]">
                <b className="font-semibold text-ink-strong">Album:</b>{" "}
                {songInfo.albumName}
              </span>
            )}
            {songInfo.genre !== "" && (
              <span className="text-[10px] text-[#60645a]">
                <b className="font-semibold text-ink-strong">Genre:</b>{" "}
                {songInfo.genre}
              </span>
            )}
            {songInfo.releaseDate !== "" && (
              <span className="text-[10px] text-[#60645a]">
                <b className="font-semibold text-ink-strong">Released:</b>{" "}
                {songInfo.releaseDate}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-1 items-center gap-[11px]">
        <button
          type="button"
          className={`grid h-[34px] w-[34px] shrink-0 place-items-center rounded-full text-[12px] text-white ${
            playing ? "bg-purple" : "bg-ink-strong"
          }`}
          onClick={togglePlay}
          aria-label={playing ? "Pause preview" : "Play preview"}
        >
          {playing ? (
            <Pause size={14} aria-hidden="true" />
          ) : (
            <Play size={14} aria-hidden="true" />
          )}
        </button>
        <span className="whitespace-nowrap text-[10px] text-muted tabular-nums">
          {formatTime(currentTime)}
        </span>
        <div className="h-[5px] flex-1 overflow-hidden rounded-full bg-line">
          <div
            className="h-full rounded-full bg-purple transition-[width] duration-150 ease-linear"
            style={{ width: progressPercent + "%" }}
          />
        </div>
        <span className="whitespace-nowrap text-[10px] text-muted tabular-nums">
          {formatTime(duration)}
        </span>
      </div>

      {songInfo.appleMusicUrl !== "" && (
        <a
          href={songInfo.appleMusicUrl}
          target="_blank"
          rel="noreferrer"
          className="whitespace-nowrap rounded-[6px] border border-line bg-surface px-[11px] py-[6px] text-[11px] font-semibold text-ink-strong hover:border-[#c4b9d1]"
        >
          ♫ Apple Music ↗
        </a>
      )}
    </div>
  );
}

function Sparkline({ market }: { market: LiveMarket }) {
  const move = lastMove(market);
  const ranks = market.history.length
    ? market.history.map((h) => h.rank)
    : [market.baseline_rank];
  return (
    <svg
      className={`block h-[30px] w-[96px] max-[580px]:w-[110px] ${
        move !== null && move < 0 ? "text-[#b48279]" : "text-[#69a38b]"
      }`}
      viewBox="0 0 110 34"
      fill="none"
      aria-hidden="true"
    >
      <path
        d={rankPath(ranks, 110, 34, 3, "fit")}
        stroke="currentColor"
        strokeWidth="2"
      />
    </svg>
  );
}

function Move({ market }: { market: LiveMarket }) {
  const move = lastMove(market);
  if (move === null) return <span className="text-up">✳ New entry</span>;
  if (move === 0) return <span>→ Held at #{market.baseline_rank}</span>;
  return (
    <span className={move > 0 ? "text-up" : "text-[#b27068]"}>
      {move > 0 ? "↗" : "↘"} {Math.abs(move)} spot
      {Math.abs(move) === 1 ? "" : "s"} last week
    </span>
  );
}

const closesShort = (m: LiveMarket) =>
  new Date(m.closes_at).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
const closesLong = (m: LiveMarket) =>
  new Date(m.closes_at).toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
async function errorText(response: Response) {
  return (
    (await response.text()).trim() || `Request failed (${response.status})`
  );
}

export default function Home() {
  const { user, logout } = useOctaveUser();
  const [authMode, setAuthMode] = useState<"signup" | "login" | null>(null);
  return (
    <>
      <TradingPage
        key={user?.uid ?? "signed-out"}
        user={user}
        logout={logout}
        setAuthMode={setAuthMode}
      />
      {authMode && (
        <AuthDialog mode={authMode} onClose={() => setAuthMode(null)} />
      )}
    </>
  );
}

function TradingPage({
  user,
  logout,
  setAuthMode,
}: {
  user: User | null;
  logout: () => Promise<void>;
  setAuthMode: (mode: "signup" | "login" | null) => void;
}) {
  const [markets, setMarkets] = useState<LiveMarket[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [side, setSide] = useState<TradeSide>("yes");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MarketFilter>("All markets");
  const [sort, setSort] = useState<MarketSort>("Chart rank");
  const [saved, setSaved] = useState<number[]>([]);
  const [quantity, setQuantity] = useState("10");
  const [limitPrice, setLimitPrice] = useState("50");
  const [bookRevision, setBookRevision] = useState(0);
  const [orders, setOrders] = useState<PendingOrder[]>([]);
  const [unfinishedOrders, setUnfinishedOrders] = useState<UnfinishedOrder[]>(
    [],
  );
  const [info, setInfo] = useState(false);
  const [watchlist, setWatchlist] = useState(false);
  const [groupsOpen, setGroupsOpen] = useState(
    () =>
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("join"),
  );
  const [leaderboardOpen, setLeaderboardOpen] = useState(false);
  const [orderMessage, setOrderMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [profile, setProfile] = useState(false);

  const fetchMarkets = useCallback(async () => {
    const response = await fetch("/api/markets", { cache: "no-store" });
    if (!response.ok) throw new Error(await errorText(response));
    return (await response.json()) as LiveMarket[];
  }, []);
  const fetchAccount = useCallback(async () => {
    if (!user) return null;
    const response = await fetch("/api/auth/me", {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(await errorText(response));
    }
    return (await response.json()) as Account;
  }, [user]);
  const fetchOrders = useCallback(async () => {
    if (!user) return [];
    const response = await fetch("/api/me/orders", {
      headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      cache: "no-store",
    });
    if (!response.ok) throw new Error(await errorText(response));
    return (await response.json()) as PendingOrder[];
  }, [user]);
  useEffect(() => {
    let current = true;
    async function loadUnfinishedOrders() {
      if (!current) return;
      if (!user) {
        setUnfinishedOrders([]);
        return;
      }
      try {
        setUnfinishedOrders(readUnfinishedOrders(localStorage, user.uid));
      } catch {
        setOrderMessage("Could not load saved orders.");
      }
    }
    void loadUnfinishedOrders();
    function storageChanged() {
      void loadUnfinishedOrders();
    }
    window.addEventListener("storage", storageChanged);
    return () => {
      current = false;
      window.removeEventListener("storage", storageChanged);
    };
  }, [user]);

  useEffect(() => {
    let current = true;

    async function loadOrders() {
      try {
        const list = await fetchOrders();
        if (current) {
          setOrders(list);
        }
      } catch (error) {
        if (current) {
          setOrderMessage(
            error instanceof Error ? error.message : "Could not load orders.",
          );
        }
      }
    }

    void loadOrders();
    return () => {
      current = false;
    };
  }, [fetchOrders]);

  useEffect(() => {
    let current = true;
    fetchMarkets()
      .then((list) => {
        if (current) setMarkets(list);
      })
      .catch((error) => {
        if (current)
          setLoadError(
            error instanceof Error ? error.message : "Could not load markets.",
          );
      });
    return () => {
      current = false;
    };
  }, [fetchMarkets]);
  useEffect(() => {
    let current = true;
    void fetchAccount()
      .then((a) => {
        if (current) setAccount(a);
      })
      .catch((error) => {
        if (current)
          setOrderMessage(
            error instanceof Error ? error.message : "Could not load account.",
          );
      });
    return () => {
      current = false;
    };
  }, [fetchAccount]);

  const selected = markets?.find((m) => m.id === selectedId) ?? null;
  const goHome = () => {
    setSelectedId(null);
    setLeaderboardOpen(false);
    setInfo(false);
    setWatchlist(false);
    setGroupsOpen(false);
    setProfile(false);
    setFilter("All markets");
  };
  const openMarket = (market: LiveMarket, choice: TradeSide = "yes") => {
    setLeaderboardOpen(false);
    setInfo(false);
    setGroupsOpen(false);
    setProfile(false);
    setSelectedId(market.id);
    setSide(choice);
    setLimitPrice(String(sidePrice(market, choice)));
    setOrderMessage("");
  };
  function selectSide(choice: TradeSide) {
    if (!selected) return;
    setSide(choice);
    setLimitPrice(String(sidePrice(selected, choice)));
    setOrderMessage("");
  }

  const count = parseQuantity(quantity);
  const holding = selected ? held(account, selected.id, side) : 0;
  const price = Number(limitPrice);
  const validPrice =
    limitPrice.trim() !== "" &&
    Number.isInteger(price) &&
    price >= 1 &&
    price <= 99;

  async function trade(action: TradeAction) {
    if (!selected) return;
    if (!user) {
      setAuthMode("signup");
      return;
    }
    if (count === null || !validPrice) {
      setOrderMessage(
        "Enter a whole number of contracts and a price from 1 to 99.",
      );
      return;
    }
    const order: UnfinishedOrder = {
      user_id: user.uid,
      market_id: selected.id,
      request_id: crypto.randomUUID(),
      side: side,
      action: action,
      price: price,
      quantity: count,
    };
    await submitOrder(order);
  }

  async function submitOrder(order: UnfinishedOrder) {
    if (!user || order.user_id !== user.uid) return;
    setBusy(true);
    try {
      saveUnfinishedOrder(localStorage, order);
      setUnfinishedOrders(readUnfinishedOrders(localStorage, user.uid));
      const token = await user.getIdToken();
      const response = await fetch(`/api/markets/${order.market_id}/orders`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          request_id: order.request_id,
          side: order.side,
          action: order.action,
          price: order.price,
          quantity: order.quantity,
        }),
      });
      if (!response.ok) {
        if (response.status === 400 || response.status === 409) {
          removeUnfinishedOrder(localStorage, order);
          if (auth.currentUser?.uid === user.uid) {
            setUnfinishedOrders(readUnfinishedOrders(localStorage, user.uid));
          }
        }
        throw new Error(await errorText(response));
      }
      const result = (await response.json()) as PendingOrder;
      removeUnfinishedOrder(localStorage, order);
      if (auth.currentUser?.uid !== user.uid) return;
      setUnfinishedOrders(readUnfinishedOrders(localStorage, user.uid));
      setBookRevision((revision) => revision + 1);
      const filled = result.quantity - result.remaining;
      let message = `Order accepted. ${filled} filled; ${result.remaining} remaining.`;
      if (result.cancelled) {
        message = `Order cancelled. ${filled} filled before cancellation.`;
      }
      setOrderMessage(message);
      try {
        const markets = await fetchMarkets();
        const account = await fetchAccount();
        const orders = await fetchOrders();
        if (auth.currentUser?.uid !== user.uid) return;
        setMarkets(markets);
        setAccount(account);
        setOrders(orders);
      } catch {
        if (auth.currentUser?.uid === user.uid) {
          setOrderMessage(message + " Refresh to update your account.");
        }
      }
    } catch (error) {
      if (auth.currentUser?.uid === user.uid) {
        const message =
          error instanceof Error ? error.message : "Order failed.";
        setOrderMessage(
          message + " If the order appears above, you can retry it.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function refreshOrders() {
    if (!user) return;
    setBusy(true);
    try {
      const account = await fetchAccount();
      const orders = await fetchOrders();
      if (auth.currentUser?.uid !== user.uid) return;
      setAccount(account);
      setOrders(orders);
      setBookRevision((revision) => revision + 1);
      setOrderMessage("Orders updated.");
    } catch (error) {
      if (auth.currentUser?.uid === user.uid) {
        setOrderMessage(
          error instanceof Error ? error.message : "Could not update orders.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function cancelOrder(id: number) {
    if (!user) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/orders/${id}/cancel`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await user.getIdToken()}` },
      });
      if (!response.ok) throw new Error(await errorText(response));
      if (auth.currentUser?.uid !== user.uid) return;
      setBookRevision((revision) => revision + 1);
      setOrderMessage("Order cancelled.");
      try {
        const orders = await fetchOrders();
        const account = await fetchAccount();
        if (auth.currentUser?.uid !== user.uid) return;
        setOrders(orders);
        setAccount(account);
      } catch {
        if (auth.currentUser?.uid === user.uid) {
          setOrderMessage("Order cancelled. Refresh to update your account.");
        }
      }
    } catch (error) {
      if (auth.currentUser?.uid === user.uid) {
        setOrderMessage(
          error instanceof Error ? error.message : "Could not cancel order.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  const all = markets ?? [];
  const visible = sortMarkets(
    all.filter(
      (m) =>
        `${m.title} ${m.artist}`.toLowerCase().includes(search.toLowerCase()) &&
        (!watchlist || saved.includes(m.id)) &&
        matchesFilter(m, filter),
    ),
    sort,
  );
  const chartDate = all[0]?.chart_date;
  let displayUsername = "Profile";
  if (user) {
    if (user.displayName) {
      displayUsername = user.displayName;
    } else if (user.email) {
      displayUsername = user.email.split("@")[0];
    }
  }
  const discoverActive =
    !info && !watchlist && !groupsOpen && !leaderboardOpen && !profile;
  const watchlistActive =
    !info && !groupsOpen && !leaderboardOpen && !profile && watchlist;

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1600px] flex-col">
      <header className="flex h-[94px] items-center gap-[65px] border-b border-line px-[5.5%] max-[1150px]:gap-[35px] max-[850px]:h-auto max-[850px]:min-h-[78px] max-[850px]:flex-wrap max-[850px]:gap-x-5 max-[850px]:gap-y-0 max-[850px]:px-[5%] max-[850px]:pt-3 max-[580px]:min-h-[72px]">
        <button
          className="inline-flex items-center p-0 text-[36px] font-extrabold tracking-[-2px] max-[850px]:text-[29px] max-[580px]:text-[26px]"
          onClick={goHome}
          aria-label="Octave home"
        >
          <Image
            src="/octave-black.png"
            alt="Octave"
            width={2170}
            height={725}
            className="block h-auto w-[110px] max-[850px]:w-[95px] max-[580px]:w-[80px]"
            priority
          />
        </button>
        <nav
          aria-label="Main navigation"
          className="flex h-full items-center gap-[30px] max-[1150px]:gap-5 max-[850px]:order-3 max-[850px]:h-[42px] max-[850px]:w-full max-[850px]:gap-[17px] max-[850px]:overflow-x-auto max-[580px]:gap-[14px]"
        >
          <button
            className={`${navBtnBase} ${discoverActive ? navBtnActive : ""}`}
            aria-current={discoverActive ? "page" : undefined}
            onClick={goHome}
          >
            Discover
          </button>
          <button
            className={`${navBtnBase} ${watchlistActive ? navBtnActive : ""}`}
            aria-current={watchlistActive ? "page" : undefined}
            onClick={() => {
              setSelectedId(null);
              setLeaderboardOpen(false);
              setInfo(false);
              setGroupsOpen(false);
              setProfile(false);
              setWatchlist(true);
              setFilter("All markets");
              setSearch("");
            }}
          >
            Watchlist{" "}
            <span className="ml-1 rounded-[4px] border border-line px-[5px] py-[2px] text-[10px]">
              {saved.length}
            </span>
          </button>
          <button
            className={`${navBtnBase} ${groupsOpen ? navBtnActive : ""}`}
            aria-current={groupsOpen ? "page" : undefined}
            onClick={() => {
              setSelectedId(null);
              setLeaderboardOpen(false);
              setInfo(false);
              setWatchlist(false);
              setProfile(false);
              setGroupsOpen(true);
            }}
          >
            Groups
          </button>
          <button
            className={`${navBtnBase} ${leaderboardOpen ? navBtnActive : ""}`}
            aria-current={leaderboardOpen ? "page" : undefined}
            onClick={() => {
              setSelectedId(null);
              setInfo(false);
              setWatchlist(false);
              setProfile(false);
              setGroupsOpen(false);
              setLeaderboardOpen(true);
            }}
          >
            Leaderboard
          </button>
        </nav>
        <div className="ml-auto flex items-center gap-[23px] max-[850px]:gap-[15px] max-[580px]:gap-3">
          {user ? (
            <>
              {account && (
                <span
                  className="whitespace-nowrap rounded-[6px] bg-purple-soft px-[10px] py-[7px] text-[12px] font-semibold text-[#6f5a91] max-[580px]:hidden"
                  title="Music Note balance"
                >
                  ♫ {account.balance.toLocaleString()}
                </span>
              )}
              <button
                className={`inline-flex items-center gap-[7px] rounded-[6px] border px-[11px] py-[7px] text-[12px] font-semibold ${
                  profile
                    ? "border-purple bg-purple-soft text-[#6f5a91]"
                    : "border-line bg-surface text-ink"
                }`}
                aria-label="Profile"
                title={displayUsername}
                onClick={() => {
                  setSelectedId(null);
                  setLeaderboardOpen(false);
                  setInfo(false);
                  setWatchlist(false);
                  setGroupsOpen(false);
                  setProfile(true);
                }}
              >
                <UserIcon size={18} aria-hidden="true" />
                <span className="max-w-[110px] truncate">
                  {displayUsername}
                </span>
              </button>
              <button
                className="py-[10px] text-[13px] font-semibold max-[580px]:text-[11px]"
                onClick={() => void logout()}
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <button
                className="py-[10px] text-[13px] font-semibold max-[580px]:text-[11px]"
                onClick={() => setAuthMode("login")}
              >
                Log in
              </button>
              <button
                className={`${primaryBtn} px-[19px] py-3 max-[850px]:gap-3 max-[850px]:px-3 max-[850px]:py-[10px] max-[850px]:text-[11px] max-[580px]:gap-2 max-[580px]:px-[10px] max-[580px]:py-[9px] max-[580px]:text-[10px]`}
                onClick={() => setAuthMode("signup")}
              >
                Get started <span>↗</span>
              </button>
            </>
          )}
        </div>
      </header>
      <main className="min-w-0 flex-1 px-[5.5%] max-[850px]:px-[5%]">
        {user &&
          unfinishedOrders
            .filter((order) => order.user_id === user.uid)
            .map((order) => (
              <div key={order.request_id} role="status">
                <span>
                  Unconfirmed order: {order.action.toUpperCase()}{" "}
                  {order.quantity} {order.side === "yes" ? "UP/STAY" : "DOWN"}{" "}
                  at ♫ {order.price} for market {order.market_id}.{" "}
                </span>
                <button
                  className={textBtn}
                  disabled={busy}
                  onClick={() => void submitOrder(order)}
                >
                  Retry (may place order)
                </button>
              </div>
            ))}
        {!selected && orderMessage && <p role="status">{orderMessage}</p>}
        {leaderboardOpen ? (
          <LeaderboardView key={user?.uid ?? "signed-out"} user={user} />
        ) : profile ? (
          <ProfileView
            key={user?.uid ?? "signed-out"}
            user={user}
            onSignUp={() => setAuthMode("signup")}
            onOpenMarket={(marketId, choice) => {
              const m = markets?.find((x) => x.id === marketId);
              if (m) {
                openMarket(m, choice);
              }
            }}
          />
        ) : groupsOpen ? (
          <GroupsView
            key={user?.uid ?? "signed-out"}
            user={user}
            onSignUp={() => setAuthMode("signup")}
          />
        ) : info ? (
          <section className="min-h-[600px] py-[70px] max-[580px]:py-[45px]">
            <h1 className="my-5 text-[58px] font-medium tracking-[-3px] max-[850px]:text-[46px] max-[580px]:text-[40px] max-[580px]:tracking-[-2px]">
              Your taste. Your edge.
            </h1>
            <p className="leading-[1.8] text-[#8a8e7f]">
              Predict what happens next on the Billboard Hot 100 using virtual
              Music Notes. Everyone starts with ♫ 10,000.
            </p>
            <div className="my-10 grid grid-cols-3 gap-[25px] max-[850px]:gap-[14px] max-[580px]:grid-cols-1">
              <article className="rounded-[9px] border border-line bg-surface p-[25px] max-[850px]:p-5">
                <b className="font-serif text-[34px] font-normal italic text-[#a18ab8]">
                  01
                </b>
                <h2 className="text-[20px] font-medium">Find your track</h2>
                <p className="text-[12px] leading-[1.8] text-[#888e7d]">
                  Every week a market opens for each song on the latest Hot 100,
                  asking whether it will go up or down on the next chart.
                </p>
              </article>
              <article className="rounded-[9px] border border-line bg-surface p-[25px] max-[850px]:p-5">
                <b className="font-serif text-[34px] font-normal italic text-[#a18ab8]">
                  02
                </b>
                <h2 className="text-[20px] font-medium">Make your call</h2>
                <p className="text-[12px] leading-[1.8] text-[#888e7d]">
                  Buy UP or DOWN contracts. At #1, choose STAY or DOWN. Prices
                  run from ♫ 1 to ♫ 99, and both sides together cost ♫ 100.
                  Place a sell order before trading closes; it fills when a
                  matching buyer is available.
                </p>
              </article>
              <article className="rounded-[9px] border border-line bg-surface p-[25px] max-[850px]:p-5">
                <b className="font-serif text-[34px] font-normal italic text-[#a18ab8]">
                  03
                </b>
                <h2 className="text-[20px] font-medium">Follow the charts</h2>
                <p className="text-[12px] leading-[1.8] text-[#888e7d]">
                  When the next chart is in, markets settle automatically: every
                  winning contract pays ♫ 100. Unchanged ranks are refunded
                  except at #1, where STAY wins. Track it all in Profile.
                </p>
              </article>
            </div>
            <button className={primaryBtn} onClick={() => setInfo(false)}>
              Explore the markets →
            </button>
          </section>
        ) : selected ? (
          <>
            <button
              className="my-7 p-0 text-[12px] text-[#7d8276]"
              onClick={() => setSelectedId(null)}
            >
              ← All markets
            </button>
            <div className="mb-6 mt-[5px] flex items-center gap-5 max-[850px]:flex-wrap max-[580px]:mb-[25px] max-[580px]:gap-[14px]">
              <Artwork
                market={selected}
                className="h-[84px] w-[78px] rounded-[4px] max-[580px]:h-[67px] max-[580px]:w-[60px]"
              />
              <div className="min-w-0 flex-1">
                <h1 className="my-[10px] text-[31px] font-medium tracking-[-1px] max-[850px]:text-[26px] max-[580px]:text-[23px] max-[580px]:leading-[1.25] max-[580px]:tracking-[-0.7px]">
                  {marketQuestion(selected)}
                </h1>
                <p className="text-[12px] text-[#929688] max-[580px]:text-[10px] max-[580px]:leading-[1.8]">
                  {selected.artist} <span className="mx-[9px]">·</span> Closes{" "}
                  {closesLong(selected)}
                </p>
              </div>
            </div>
            <div className="mb-[70px] grid grid-cols-[minmax(0,1fr)_335px] gap-8 max-[1150px]:grid-cols-[minmax(0,1fr)_300px] max-[1150px]:gap-5 max-[850px]:grid-cols-1">
              <section className="rounded-[10px] border border-line bg-surface p-7 max-[1150px]:p-5 max-[580px]:p-[18px]">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="text-[11px] text-muted">
                      {sideLabel(selected.baseline_rank, "yes")} estimate
                    </span>
                    <strong className="mt-2 block text-[42px] font-medium tracking-[-1.5px] max-[580px]:text-[36px]">
                      {selected.yes_price}%{" "}
                      <small className="ml-3 text-[12px] tracking-normal">
                        <Move market={selected} />
                      </small>
                    </strong>
                  </div>
                  <span className={sampleBadge}>Hot 100 rank</span>
                </div>
                <div className="relative mt-[30px] h-[250px] pr-10 max-[580px]:h-[200px]">
                  <div className="absolute inset-0 flex flex-col justify-between">
                    {["#1", "#25", "#50", "#75", "#100"].map((label) => (
                      <span
                        key={label}
                        className="border-t border-dashed border-[#e9e8e0] text-right text-[9px] leading-none text-[#9a9c92]"
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                  <svg
                    className="relative h-full w-full"
                    viewBox="0 0 700 240"
                    preserveAspectRatio="none"
                    role="img"
                    aria-label={`${selected.title}'s Hot 100 rank over the last ${Math.max(selected.history.length, 1)} weeks, now #${selected.baseline_rank}`}
                  >
                    <defs>
                      <linearGradient
                        id="chartFill"
                        x1="0"
                        y1="0"
                        x2="0"
                        y2="1"
                      >
                        <stop stopColor="#8e7bbc" stopOpacity=".24" />
                        <stop offset="1" stopColor="#8e7bbc" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {(() => {
                      const line = rankPath(
                        selected.history.length
                          ? selected.history.map((h) => h.rank)
                          : [selected.baseline_rank],
                        700,
                        240,
                        0,
                      );
                      return (
                        <>
                          <path d={`${line} V240 H0Z`} fill="url(#chartFill)" />
                          <path
                            d={line}
                            stroke="#8c72b4"
                            strokeWidth="3"
                            fill="none"
                            vectorEffect="non-scaling-stroke"
                          />
                        </>
                      );
                    })()}
                  </svg>
                </div>
                <div className="mb-6 mr-10 mt-[14px] flex justify-between text-[9px] text-[#999c90]">
                  {(selected.history.length
                    ? selected.history
                    : [
                        {
                          chart_date: selected.chart_date,
                          rank: selected.baseline_rank,
                        },
                      ]
                  ).map((h) => (
                    <span key={h.chart_date}>{shortDate(h.chart_date)}</span>
                  ))}
                </div>
                <div className="flex items-center justify-between text-[10px] text-[#8c9083] max-[580px]:text-[9px]">
                  <span>
                    ♫ {selected.volume.toLocaleString()} contracts traded
                  </span>
                  <span>
                    Settles on the {shortDate(selected.chart_date)} chart
                  </span>
                </div>
                <OrderBook
                  key={"book-" + selected.id}
                  market={selected}
                  side={side}
                  refresh={bookRevision}
                  onSide={selectSide}
                  onPrice={(price) => setLimitPrice(String(price))}
                />
                <SongPreview key={"preview-" + selected.id} market={selected} />
                <div className="mt-6 border-t border-line pt-5">
                  <p className="text-[11px] leading-[1.8] text-[#8b9081] max-[580px]:text-[10px]">
                    Winning contracts pay ♫ 100. Trading closes{" "}
                    {closesLong(selected)}.
                  </p>
                </div>
              </section>
              <aside className="h-fit rounded-[10px] border border-line bg-surface p-6">
                <div className="-mx-6 -mt-6 mb-5 flex items-center justify-between gap-4 rounded-t-[10px] border-b border-line bg-surface px-6 py-4">
                  <Image
                    src="/billboard-logo.svg"
                    alt="Billboard Hot 100"
                    width={150}
                    height={32}
                    className="h-auto w-[150px]"
                  />
                  <div className="text-right">
                    <span className="block text-[11px] text-[#777b72]">
                      Current rank
                    </span>
                    <strong className="mt-[2px] block text-[22px] font-bold text-ink-strong">
                      #{selected.baseline_rank}
                    </strong>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <h2 className="text-[19px] font-medium tracking-[-0.6px]">
                    Make your call
                  </h2>
                  <span className="text-[14px] font-semibold text-ink-strong">
                    {account
                      ? `♫ ${account.balance.toLocaleString()}`
                      : "♫ Music Notes"}
                  </span>
                </div>

                <div className="mb-[25px] mt-4 flex gap-[9px]">
                  <button
                    className={`flex flex-1 justify-between rounded-[5px] border bg-up-bg p-3 text-[11px] text-[#4f826a] ${
                      side === "yes"
                        ? "border-current opacity-100"
                        : "border-transparent opacity-60"
                    }`}
                    aria-pressed={side === "yes"}
                    onClick={() => selectSide("yes")}
                  >
                    {sideLabel(selected.baseline_rank, "yes")}{" "}
                    <b>♫ {selected.yes_price}</b>
                  </button>
                  <button
                    className={`flex flex-1 justify-between rounded-[5px] border bg-down-bg p-3 text-[11px] text-down ${
                      side === "no"
                        ? "border-current opacity-100"
                        : "border-transparent opacity-60"
                    }`}
                    aria-pressed={side === "no"}
                    onClick={() => selectSide("no")}
                  >
                    DOWN <b>♫ {selected.no_price}</b>
                  </button>
                </div>

                <label
                  className="mb-[9px] block text-[10px] text-[#898e7f]"
                  htmlFor="limit-price"
                >
                  Limit price (1–99)
                </label>
                <div className="mb-4 flex items-center gap-[10px] rounded-[5px] border border-[#d9dece] p-[13px] text-[#8b977a]">
                  <span>♫</span>
                  <input
                    id="limit-price"
                    className="w-full border-0 bg-transparent text-[22px] text-[#343c2d] outline-none"
                    type="number"
                    min="1"
                    max="99"
                    step="1"
                    value={limitPrice}
                    onChange={(e) => setLimitPrice(e.target.value)}
                  />
                </div>

                <label
                  className="mb-[9px] block text-[10px] text-[#898e7f]"
                  htmlFor="quantity"
                >
                  Contracts
                </label>
                <div className="flex items-center gap-[10px] rounded-[5px] border border-[#d9dece] p-[13px] text-[#8b977a]">
                  <span>×</span>
                  <input
                    id="quantity"
                    className="w-full border-0 bg-transparent text-[22px] text-[#343c2d] outline-none"
                    type="number"
                    min="1"
                    max="1000000"
                    step="1"
                    value={quantity}
                    onChange={(e) => setQuantity(e.target.value)}
                  />
                </div>

                <div className="mt-[10px] flex gap-[5px]">
                  {[1, 5, 10, 25].map((n) => (
                    <button
                      key={n}
                      className="flex-1 rounded-[4px] bg-[#f3f3ec] px-[2px] py-2 text-[9px] text-[#818873]"
                      onClick={() => setQuantity(String(n))}
                    >
                      {n}
                    </button>
                  ))}
                </div>

                <dl className="mb-[23px] mt-[27px] text-[11px]">
                  <div className="my-[14px] flex justify-between gap-[10px]">
                    <dt className="text-[#8a907f]">Limit price</dt>
                    <dd>{validPrice ? `♫ ${price}` : "—"}</dd>
                  </div>
                  <div className="my-[14px] flex justify-between gap-[10px]">
                    <dt className="text-[#8a907f]">Limit total</dt>
                    <dd>
                      {count && validPrice
                        ? `♫ ${(price * count).toLocaleString()}`
                        : "—"}
                    </dd>
                  </div>
                  <div className="my-[14px] flex justify-between gap-[10px]">
                    <dt className="text-[#8a907f]">You hold</dt>
                    <dd>
                      {holding.toLocaleString()}{" "}
                      {sideLabel(selected.baseline_rank, side)}
                    </dd>
                  </div>
                  <div className="my-[14px] flex items-center justify-between gap-[10px] border-t border-line pt-5">
                    <dt className="text-[#8a907f]">
                      Potential payout{" "}
                      <small className="mt-[6px] block text-[9px]">
                        if {sideLabel(selected.baseline_rank, side)} wins
                      </small>
                    </dt>
                    <dd className="text-[23px] tracking-[-1px] text-[#5a8569]">
                      ♫ {count ? (count * 100).toLocaleString() : 0}
                    </dd>
                  </div>
                </dl>

                <button
                  className="inline-flex w-full items-center justify-between gap-[25px] rounded-[7px] border border-[#d4e8bc] bg-[#d4e8bc] px-[22px] py-[15px] text-[13px] font-semibold text-[#3c512f] disabled:cursor-not-allowed disabled:opacity-45"
                  disabled={busy || count === null || !validPrice}
                  onClick={() => void trade("buy")}
                >
                  {user
                    ? `Buy ${sideLabel(selected.baseline_rank, side)}`
                    : "Sign up to trade"}{" "}
                  <span>↗</span>
                </button>

                {user && (
                  <button
                    className="mt-[9px] inline-flex w-full items-center justify-between gap-[25px] rounded-[7px] border border-[#cfdcc1] bg-white px-[22px] py-[15px] text-[13px] font-semibold text-[#3c512f] disabled:cursor-not-allowed disabled:opacity-45"
                    disabled={
                      busy || count === null || !validPrice || holding < count
                    }
                    onClick={() => void trade("sell")}
                  >
                    Sell {sideLabel(selected.baseline_rank, side)}{" "}
                    <span>↙</span>
                  </button>
                )}

                {user && (
                  <button
                    className={textBtn}
                    disabled={busy}
                    onClick={() => void refreshOrders()}
                  >
                    Refresh orders
                  </button>
                )}

                {orders
                  .filter((order) => order.market_id === selected.id)
                  .map((order) => (
                    <div
                      className="mt-[10px] rounded-[8px] border border-line p-3"
                      key={order.id}
                    >
                      <span className="block">
                        <strong>
                          {order.action.toUpperCase()}{" "}
                          {sideLabel(selected.baseline_rank, order.side)}
                        </strong>
                        <span className="mt-[6px] block text-[12px] text-[#666d60]">
                          ♫ {order.price} each · {order.remaining} waiting
                        </span>
                      </span>
                      <button
                        className={`${textBtn} text-[#9b3026]`}
                        disabled={busy}
                        onClick={() => void cancelOrder(order.id)}
                      >
                        Cancel
                      </button>
                    </div>
                  ))}

                <p
                  role="status"
                  className="text-[11px] leading-[1.6] text-[#6e7d61] empty:hidden"
                >
                  {orderMessage}
                </p>
              </aside>
            </div>
          </>
        ) : (
          <>
            {!watchlist && (
              <section className="grid min-h-[438px] grid-cols-[1.15fr_1fr] items-center gap-[30px] border-b border-line pb-[45px] pt-[42px] min-[1450px]:min-h-[490px] max-[850px]:min-h-[380px] max-[850px]:gap-3 max-[580px]:grid-cols-1 max-[580px]:gap-0 max-[580px]:pb-[15px] max-[580px]:pt-9">
                <div className="max-[580px]:relative max-[580px]:z-[1]">
                  <h1 className="mb-[18px] mt-[22px] text-[62px] font-medium leading-[1.06] tracking-[-3.3px] min-[1450px]:text-[72px] max-[1150px]:text-[54px] max-[850px]:text-[46px] max-[850px]:tracking-[-2px] max-[580px]:mb-[15px] max-[580px]:mt-[18px] max-[580px]:text-[53px]">
                    Good taste.
                    <br />
                    Better{" "}
                    <span className="font-serif italic tracking-[-3px] text-[#8b75a4] max-[850px]:tracking-[-2px]">
                      predictions.
                    </span>
                  </h1>
                  <p className="text-[13px] leading-[1.8] text-[#777b72] max-[850px]:text-[11px] max-[580px]:text-[12px]">
                    Think you know the charts? Hope you don&apos;t fall flat!
                  </p>
                  <div className="mt-[25px] flex items-center gap-[25px] max-[850px]:gap-[15px] max-[580px]:flex-wrap">
                    <a
                      className={`${primaryBtn} max-[850px]:gap-[18px] max-[850px]:px-[14px] max-[850px]:py-3 max-[850px]:text-[11px] max-[580px]:px-[18px] max-[580px]:py-[14px] max-[580px]:text-[12px]`}
                      href="#markets"
                    >
                      Explore markets <span>↗</span>
                    </a>
                    <button
                      className="inline-flex items-center justify-between gap-[25px] rounded-[7px] border border-[#b8bbae] bg-transparent px-[22px] py-[15px] text-[13px] font-semibold text-ink hover:bg-[#eeeee5] max-[850px]:gap-[18px] max-[850px]:px-[14px] max-[850px]:py-3 max-[850px]:text-[11px] max-[580px]:px-[18px] max-[580px]:py-[14px] max-[580px]:text-[12px]"
                      onClick={() => setInfo(true)}
                    >
                      How it works <span>↗</span>
                    </button>
                  </div>
                </div>
              </section>
            )}
            <section
              className="scroll-mt-5 pb-10 pt-[38px] max-[580px]:pt-[30px]"
              id="markets"
            >
              <div className="mb-[25px] flex items-end justify-between max-[580px]:mb-5 max-[580px]:items-start max-[580px]:gap-3">
                <div>
                  <h2 className="mt-[9px] text-[28px] font-medium tracking-[-1px] max-[850px]:text-[25px] max-[580px]:text-[23px] max-[580px]:tracking-[-0.8px]">
                    Find your next move<span className="text-purple">.</span>
                  </h2>
                </div>
                <span className="flex items-center gap-2 text-[10px] text-[#7e8175] max-[850px]:text-[9px] max-[580px]:max-w-[90px] max-[580px]:flex-wrap max-[580px]:justify-end max-[580px]:gap-[5px] max-[580px]:text-[0px] max-[580px]:[&_svg]:hidden">
                  <Clock size={15} aria-hidden="true" /> Weekly markets
                  {chartDate && (
                    <> · settle on the {shortDate(chartDate)} chart</>
                  )}{" "}
                  <span className={sampleBadge}>{all.length} live</span>
                </span>
              </div>
              <div className="mb-[22px] flex items-center justify-between gap-5 max-[1150px]:flex-col max-[1150px]:items-start max-[580px]:gap-3">
                <div
                  className="flex flex-wrap items-center gap-1 max-[580px]:gap-[2px]"
                  role="group"
                  aria-label="Filter markets"
                >
                  {MARKET_FILTERS.map((f) => (
                    <button
                      key={f}
                      aria-pressed={filter === f}
                      className={`whitespace-nowrap rounded-[5px] px-3 py-[9px] text-[11px] max-[580px]:px-[10px] max-[580px]:py-2 max-[580px]:text-[10px] ${
                        filter === f
                          ? "bg-[#2e332c] text-white"
                          : "text-[#7d8075]"
                      }`}
                      onClick={() => setFilter(f)}
                    >
                      {f === "Rising"
                        ? "↗ "
                        : f === "Falling"
                          ? "↘ "
                          : f === "New entries"
                            ? "✳ "
                            : ""}
                      {f}
                    </button>
                  ))}
                </div>
                <div className="flex gap-[10px] max-[1150px]:w-full max-[1150px]:justify-between">
                  <label className="flex items-center gap-[9px] rounded-[5px] border border-line bg-surface-alt px-[11px] py-[9px] text-[#92958a] max-[1150px]:flex-1">
                    <Search size={17} aria-hidden="true" />
                    <input
                      className="w-[147px] border-0 bg-transparent text-[10px] outline-none max-[1150px]:w-full"
                      aria-label="Search songs or artists"
                      placeholder="Search songs or artists"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    className="max-w-[115px] rounded-[5px] border border-line bg-surface-alt p-2 text-[10px] text-[#656b60]"
                    aria-label="Sort markets"
                    value={sort}
                    onChange={(e) => setSort(e.target.value as MarketSort)}
                  >
                    {MARKET_SORTS.map((s) => (
                      <option key={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>
              {loadError ? (
                <div className="px-[10px] py-[60px] text-center text-[#83867a]">
                  <Music className="mx-auto" size={32} aria-hidden="true" />
                  <h3 className="text-[#343b30]">Markets are unavailable.</h3>
                  <p>{loadError}</p>
                </div>
              ) : markets === null ? (
                <div className="px-[10px] py-[60px] text-center text-[#83867a]">
                  <Music className="mx-auto" size={32} aria-hidden="true" />
                  <h3 className="text-[#343b30]">Loading markets…</h3>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-[18px] max-[850px]:grid-cols-2 max-[580px]:grid-cols-1 max-[580px]:gap-[15px]">
                    {visible.map((m) => (
                      <article
                        className="min-w-0 rounded-[10px] border border-[#e4e4db] bg-surface-card px-[19px] pt-5 transition-[box-shadow,border-color] duration-200 hover:border-[#c4b9d1] hover:shadow-[0_4px_15px_#57513c08] min-[1450px]:px-[23px] min-[1450px]:pt-[23px] max-[1150px]:px-[14px] max-[1150px]:pt-4 max-[850px]:px-[19px] max-[850px]:pt-5 max-[580px]:px-5 max-[580px]:pt-5"
                        key={m.id}
                      >
                        <div className="flex items-center gap-3 max-[1150px]:gap-2 max-[580px]:gap-3">
                          <Artwork market={m} />
                          <div className="min-w-0">
                            <span className="text-[8px] text-[#95968a] max-[580px]:text-[9px]">
                              Hot 100 <span className="mx-[3px]">·</span> Now #
                              {m.baseline_rank}
                            </span>
                            <button
                              className="block max-w-[190px] truncate pt-[5px] text-left text-[14px] font-semibold tracking-[-0.3px] max-[1150px]:max-w-[110px] max-[1150px]:text-[12px] max-[850px]:max-w-[180px] max-[850px]:text-[14px] max-[580px]:max-w-[220px] max-[580px]:text-[15px]"
                              onClick={() => openMarket(m)}
                            >
                              {m.title}
                            </button>
                            <p className="mt-1 text-[10px] text-[#8b8d83] max-[580px]:text-[11px]">
                              {m.artist}
                            </p>
                          </div>
                          <button
                            className={`ml-auto shrink-0 self-start p-[2px] ${
                              saved.includes(m.id)
                                ? "saved-star text-purple"
                                : "text-[#a3a598]"
                            }`}
                            aria-label={`${saved.includes(m.id) ? "Remove" : "Save"} ${m.title} ${saved.includes(m.id) ? "from" : "to"} watchlist`}
                            aria-pressed={saved.includes(m.id)}
                            onClick={() =>
                              setSaved(
                                saved.includes(m.id)
                                  ? saved.filter((id) => id !== m.id)
                                  : [...saved, m.id],
                              )
                            }
                          >
                            <Star size={18} aria-hidden="true" />
                          </button>
                        </div>
                        <button
                          className="mb-[18px] mt-5 block min-h-[40px] w-full max-w-[260px] p-0 text-left text-[13px] font-medium leading-[1.55] min-[1450px]:max-w-[290px] min-[1450px]:text-[15px] max-[580px]:my-[21px] max-[580px]:min-h-0 max-[580px]:max-w-none max-[580px]:text-[14px]"
                          onClick={() => openMarket(m)}
                        >
                          {marketQuestion(m)}
                        </button>
                        <div className="mb-[17px] flex items-center justify-between">
                          <div>
                            <strong className="block text-[34px] font-medium leading-none tracking-[-1.5px] max-[580px]:text-[36px]">
                              {m.yes_price}
                              <span className="text-[23px]">%</span>
                            </strong>
                            <span className="mt-[7px] block text-[9px] text-[#93968b]">
                              {sideLabel(m.baseline_rank, "yes")} estimate
                            </span>
                          </div>
                          <div className="text-right [&>span]:mt-[5px] [&>span]:block [&>span]:text-[8px]">
                            <Sparkline market={m} />
                            <Move market={m} />
                          </div>
                        </div>
                        <div className="flex gap-[9px]">
                          <button
                            className="flex flex-1 justify-between rounded-[5px] bg-up-bg px-3 py-[11px] text-[11px] text-[#4f826a] hover:-translate-y-[2px] max-[1150px]:px-[9px] max-[1150px]:py-[10px] max-[580px]:p-[13px] max-[580px]:text-[12px]"
                            onClick={() => openMarket(m, "yes")}
                          >
                            <span>{sideLabel(m.baseline_rank, "yes")}</span>
                            <b>♫ {m.yes_price}</b>
                          </button>
                          <button
                            className="flex flex-1 justify-between rounded-[5px] bg-down-bg px-3 py-[11px] text-[11px] text-down hover:-translate-y-[2px] max-[1150px]:px-[9px] max-[1150px]:py-[10px] max-[580px]:p-[13px] max-[580px]:text-[12px]"
                            onClick={() => openMarket(m, "no")}
                          >
                            <span>DOWN</span>
                            <b>♫ {m.no_price}</b>
                          </button>
                        </div>
                        <div className="mt-[17px] flex items-center justify-between border-t border-[#eeeee7] py-3 text-[8px] text-[#96988c] max-[580px]:py-[14px] max-[580px]:text-[9px]">
                          <span>♫ {m.volume.toLocaleString()} contracts</span>
                          <span className="flex items-center gap-[5px]">
                            Closes{" "}
                            <b className="font-medium text-[#686f60]">
                              {closesShort(m)}
                            </b>
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                  {!visible.length && (
                    <div className="px-[10px] py-[60px] text-center text-[#83867a]">
                      <Music className="mx-auto" size={32} aria-hidden="true" />
                      <h3 className="text-[#343b30]">
                        {all.length
                          ? "No tracks here yet."
                          : "No open markets yet."}
                      </h3>
                      <p>
                        {!all.length
                          ? "Markets open once a full Hot 100 chart is loaded."
                          : watchlist
                            ? "Tap a star on a market to save it to your watchlist."
                            : "Try another artist, song, or filter."}
                      </p>
                      {all.length > 0 && (
                        <button
                          className={textBtn}
                          onClick={() => {
                            setSearch("");
                            setFilter("All markets");
                            setWatchlist(false);
                          }}
                        >
                          See all markets →
                        </button>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
            <section className="mb-[45px] flex items-center gap-[23px] rounded-[8px] border border-[#dedfd2] bg-[#efefe5] px-[30px] py-[26px] max-[850px]:gap-[17px] max-[850px]:px-5 max-[850px]:py-[23px] max-[580px]:flex-wrap max-[580px]:gap-[14px]">
              <span className="text-[46px] leading-none text-[#7a8560] max-[580px]:text-[35px]">
                ✳
              </span>
              <div className="max-[580px]:flex-1">
                <h2 className="mb-[7px] text-[21px] font-medium tracking-[-0.5px] max-[850px]:text-[17px] max-[580px]:leading-[1.4]">
                  A good ear deserves a little credit.
                </h2>
                <p className="text-[11px] text-[#818576] max-[850px]:text-[10px] max-[580px]:leading-[1.6]">
                  Follow the charts. Make your predictions. Find your edge.
                </p>
              </div>
              <button
                className={`${primaryBtn} ml-auto whitespace-nowrap max-[850px]:gap-[10px] max-[850px]:px-[14px] max-[850px]:py-3 max-[850px]:text-[11px] max-[580px]:ml-[49px]`}
                onClick={() => (user ? setInfo(true) : setAuthMode("signup"))}
              >
                {user ? "How it works" : "Join the next wave"} ↗
              </button>
            </section>
          </>
        )}
      </main>
      <footer className="grid grid-cols-[1fr_auto_1fr] items-center gap-[25px] border-t border-line px-[5.5%] py-[25px] text-[10px] text-[#8d9083] max-[580px]:grid-cols-[1fr_auto] max-[580px]:gap-[15px] max-[580px]:px-[5%] max-[580px]:py-[22px]">
        <button
          className="inline-flex items-center p-0 text-[23px] font-extrabold tracking-[-1.5px] text-[#53594a] max-[580px]:text-[21px]"
          onClick={goHome}
        >
          <Image
            src="/octave-black.png"
            alt="Octave"
            width={2170}
            height={725}
            className="block h-auto w-[100px] max-[850px]:w-[95px] max-[580px]:w-[80px]"
          />
        </button>
        <span className="max-[580px]:col-span-full max-[580px]:row-start-2 max-[580px]:text-center max-[580px]:text-[9px]">
          Made for music minds.
        </span>
        <span className="flex justify-self-end gap-[30px] text-[9px] max-[850px]:gap-[15px] max-[850px]:text-[8px] max-[580px]:w-auto max-[580px]:justify-between">
          © 2026 Octave
        </span>
      </footer>
      {user && <Tutorial key={user.uid} />}
    </div>
  );
}
