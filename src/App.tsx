import React, { Component, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import CryptoJS from "crypto-js";
import Peer from "simple-peer";
import { Video, VideoOff, Mic, MicOff, MessageSquare, Send, SkipForward, Users, Zap, User, LogOut, Settings, Camera, X, Search, UserPlus, ChevronLeft, ChevronDown, Maximize, Minimize, Languages } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { auth, db, googleProvider } from "./firebase";
import { signInWithPopup, signOut, onAuthStateChanged, User as FirebaseUser } from "firebase/auth";
import { doc, getDoc, setDoc, updateDoc, onSnapshot, serverTimestamp, query, collection, where, getDocs, addDoc, orderBy, limit } from "firebase/firestore";
import { GoogleGenAI } from "@google/genai";

interface Message {
  userId: string;
  text: string;
  timestamp: string;
  displayName?: string;
  isPremium?: boolean;
  translatedText?: string;
}

interface UserProfile {
  uid: string;
  displayName: string;
  username?: string;
  bio?: string;
  gender?: string;
  country?: string;
  photoURL?: string;
  isPremium?: boolean;
  premiumUntil?: any;
  role?: string;
  createdAt: any;
}

const APP_LOGO = "https://rajnishmodz.42web.io/uploads/1775029844_file_00000000ea7071fabd96d434616d26f2.png";
const PAYMENT_QR = "https://rajnishmodz.42web.io/uploads/1775029524_Screenshot_20260401-131210.png";

interface PaymentRequest {
  id: string;
  userId: string;
  userEmail: string;
  amount: number;
  utr: string;
  screenshotURL: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: any;
}

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string | null;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export class ErrorBoundary extends Component<any, any> {
  state = { hasError: false, error: null };

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      let displayError = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.error.message);
        if (parsed.error) displayError = `Firestore Error: ${parsed.error} (${parsed.operationType} on ${parsed.path})`;
      } catch (e) {
        displayError = this.state.error?.message || String(this.state.error);
      }

      return (
        <div className="min-h-screen bg-black flex items-center justify-center p-8 text-center">
          <div className="max-w-md w-full bg-zinc-900 p-8 rounded-3xl border border-red-500/20">
            <h2 className="text-2xl font-bold text-red-500 mb-4">Application Error</h2>
            <p className="text-white/60 text-sm mb-6">{displayError}</p>
            <button 
              onClick={() => window.location.reload()}
              className="px-8 py-3 bg-white text-black font-bold rounded-full hover:bg-orange-500 hover:text-white transition-all"
            >
              RELOAD APP
            </button>
          </div>
        </div>
      );
    }
    return (this as any).props.children;
  }
}

const TranslatedMessage = ({ text, targetLang, isOwn, translateFn, autoTranslate }: { text: string, targetLang: string, isOwn: boolean, translateFn: any, autoTranslate: boolean }) => {
  const [translated, setTranslated] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleTranslate = async () => {
    if (!text || loading) return;
    setLoading(true);
    try {
      const res = await translateFn(text, targetLang);
      setTranslated(res);
    } catch (e) {
      console.error("Translation error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (autoTranslate && !isOwn && text && !translated) {
      handleTranslate();
    }
  }, [text, targetLang, isOwn, autoTranslate]);

  return (
    <div className="group relative">
      <div>{text}</div>
      {translated && translated !== text && (
        <div className="mt-1 pt-1 border-t border-current opacity-40 text-[10px] italic flex items-center gap-1">
          <Languages size={10} className="opacity-70" />
          <span className="opacity-90">{translated}</span>
        </div>
      )}
      {loading && (
        <div className="mt-1 pt-1 border-t border-current opacity-20 text-[10px] animate-pulse flex items-center gap-1">
          <Zap size={10} className="animate-spin opacity-50" />
          <span className="opacity-60">Translating to {targetLang}...</span>
        </div>
      )}
      {!translated && !loading && (
        <button 
          onClick={handleTranslate}
          className={`mt-1 text-[9px] ${isOwn ? 'text-white/50 hover:text-white' : 'text-blue-500 hover:text-blue-600'} flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity`}
        >
          <Languages size={10} />
          Translate to {targetLang}
        </button>
      )}
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [peerProfile, setPeerProfile] = useState<UserProfile | null>(null);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [isWalletModalOpen, setIsWalletModalOpen] = useState(false);
  const [isVIPPopupOpen, setIsVIPPopupOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [isUpsellModalOpen, setIsUpsellModalOpen] = useState(false);
  const [isDemoPremium, setIsDemoPremium] = useState(false);
  const [onlineCount, setOnlineCount] = useState(0);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editGender, setEditGender] = useState("");
  const [editCountry, setEditCountry] = useState("");
  const [autoTranslate, setAutoTranslate] = useState(false);
  const [targetLanguage, setTargetLanguage] = useState("English");

  // Payment Form State
  const [paymentUTR, setPaymentUTR] = useState("");
  const [paymentScreenshot, setPaymentScreenshot] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("89");
  const [pendingPayments, setPendingPayments] = useState<PaymentRequest[]>([]);
  const [userPendingPayment, setUserPendingPayment] = useState<PaymentRequest | null>(null);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [room, setRoom] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputText, setInputText] = useState("");
  const [isMatching, setIsMatching] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');
  const [nextCount, setNextCount] = useState(0);
  const [showAd, setShowAd] = useState(false);
  const [adCountdown, setAdCountdown] = useState(5);
  const [peer, setPeer] = useState<Peer.Instance | null>(null);
  const [isSocialModalOpen, setIsSocialModalOpen] = useState(false);
  const [searchUsername, setSearchUsername] = useState("");
  const [searchResults, setSearchResults] = useState<UserProfile[]>([]);
  const [selectedFriend, setSelectedFriend] = useState<UserProfile | null>(null);
  const [personalMessages, setPersonalMessages] = useState<any[]>([]);
  const [personalInput, setPersonalInput] = useState("");
  const [friendRequests, setFriendRequests] = useState<any[]>([]);
  const [friends, setFriends] = useState<UserProfile[]>([]);
  const [isUsernameModalOpen, setIsUsernameModalOpen] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [isChatAccepted, setIsChatAccepted] = useState(false);
  const [hasSentChatRequest, setHasSentChatRequest] = useState(false);
  const [hasReceivedChatRequest, setHasReceivedChatRequest] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch((e) => {
        console.error(`Error attempting to enable full-screen mode: ${e.message} (${e.name})`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const isPremiumExpired = profile?.premiumUntil ? (
    profile.premiumUntil.toDate ? profile.premiumUntil.toDate() < new Date() : new Date(profile.premiumUntil) < new Date()
  ) : false;

  const displayProfile = profile ? { ...profile, isPremium: (profile.isPremium && !isPremiumExpired) || isDemoPremium } : null;

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const personalChatEndRef = useRef<HTMLDivElement>(null);

  // Auth & Profile Logic
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const userDoc = await getDoc(doc(db, "users", firebaseUser.uid));
          if (userDoc.exists()) {
            const data = userDoc.data() as UserProfile;
            setProfile(data);
            setEditName(data.displayName);
            setEditBio(data.bio || "");
            setEditGender(data.gender || "");
            setEditCountry(data.country || "");
            if (!data.username) {
              setIsUsernameModalOpen(true);
            }
          } else {
            const newProfile: UserProfile = {
              uid: firebaseUser.uid,
              displayName: firebaseUser.displayName || "New Viber",
              photoURL: firebaseUser.photoURL || "",
              role: "user",
              gender: "",
              country: "",
              createdAt: serverTimestamp(),
            };
            await setDoc(doc(db, "users", firebaseUser.uid), newProfile);
            setProfile(newProfile);
            setEditName(newProfile.displayName);
            setIsUsernameModalOpen(true);
          }
        } catch (error) {
          handleFirestoreError(error, OperationType.GET, `users/${firebaseUser.uid}`);
        }
      } else {
        setProfile(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Fetch user's pending payment
  useEffect(() => {
    if (user) {
      const path = "payments";
      const q = query(collection(db, path), where("userId", "==", user.uid), where("status", "==", "pending"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        if (!snapshot.empty) {
          setUserPendingPayment({ id: snapshot.docs[0].id, ...snapshot.docs[0].data() } as PaymentRequest);
        } else {
          setUserPendingPayment(null);
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      });
      return () => unsubscribe();
    }
  }, [user]);

  // Hidden Admin Access
  useEffect(() => {
    const checkAdminPath = () => {
      if (window.location.pathname === '/Rajnish') {
        setIsAdminModalOpen(true);
        // We don't clear the path here to avoid reloading the app, 
        // but we can use history.pushState to clean it up if needed.
        window.history.replaceState({}, '', '/');
      }
    };
    checkAdminPath();
    // Also listen for popstate in case of navigation
    window.addEventListener('popstate', checkAdminPath);
    return () => window.removeEventListener('popstate', checkAdminPath);
  }, []);

  // VIP Popup Timer
  useEffect(() => {
    if (room && !displayProfile?.isPremium) {
      const timer = setTimeout(() => {
        setIsVIPPopupOpen(true);
      }, 30000); // Show after 30 seconds of chat
      return () => clearTimeout(timer);
    }
  }, [room, displayProfile?.isPremium]);

  // Fetch friend requests
  useEffect(() => {
    if (user) {
      const q = query(collection(db, "friendRequests"), where("toId", "==", user.uid), where("status", "==", "pending"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        setFriendRequests(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, "friendRequests");
      });
      return () => unsubscribe();
    }
  }, [user]);

  // Fetch friends
  useEffect(() => {
    if (user) {
      const q1 = query(collection(db, "friendRequests"), where("fromId", "==", user.uid), where("status", "==", "accepted"));
      const q2 = query(collection(db, "friendRequests"), where("toId", "==", user.uid), where("status", "==", "accepted"));
      
      const unsub1 = onSnapshot(q1, async (snapshot) => {
        const friendIds = snapshot.docs.map(doc => doc.data().toId);
        if (friendIds.length > 0) {
          const friendsData = await Promise.all(friendIds.map(async id => {
            const docSnap = await getDoc(doc(db, "users", id));
            return docSnap.data() as UserProfile;
          }));
          setFriends(prev => {
            const existingIds = new Set(prev.map(f => f.uid));
            const newFriends = friendsData.filter(f => !existingIds.has(f.uid));
            return [...prev, ...newFriends];
          });
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, "friendRequests");
      });

      const unsub2 = onSnapshot(q2, async (snapshot) => {
        const friendIds = snapshot.docs.map(doc => doc.data().fromId);
        if (friendIds.length > 0) {
          const friendsData = await Promise.all(friendIds.map(async id => {
            const docSnap = await getDoc(doc(db, "users", id));
            return docSnap.data() as UserProfile;
          }));
          setFriends(prev => {
            const existingIds = new Set(prev.map(f => f.uid));
            const newFriends = friendsData.filter(f => !existingIds.has(f.uid));
            return [...prev, ...newFriends];
          });
        }
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, "friendRequests");
      });

      return () => { unsub1(); unsub2(); };
    }
  }, [user]);

  const handleScreenshotUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPaymentScreenshot(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSearch = async () => {
    if (!searchUsername) return;
    const q = query(collection(db, "users"), where("username", "==", searchUsername.toLowerCase()));
    const snapshot = await getDocs(q);
    setSearchResults(snapshot.docs.map(doc => doc.data() as UserProfile).filter(u => u.uid !== user?.uid));
  };

  const sendFriendRequest = async (toUser: UserProfile) => {
    if (!user || !profile) return;
    
    // Check if already friends
    if (friends.some(f => f.uid === toUser.uid)) {
      alert("You are already friends!");
      return;
    }

    // Check if request already sent
    const q = query(
      collection(db, "friendRequests"), 
      where("fromId", "==", user.uid), 
      where("toId", "==", toUser.uid),
      where("status", "==", "pending")
    );
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      alert("Friend request already sent!");
      return;
    }

    try {
      await addDoc(collection(db, "friendRequests"), {
        fromId: user.uid,
        fromName: profile.displayName,
        toId: toUser.uid,
        status: "pending",
        createdAt: serverTimestamp(),
      });
      alert("Friend request sent!");
      setSearchResults([]); // Clear search after sending
      setSearchUsername("");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "friendRequests");
    }
  };

  const acceptFriendRequest = async (requestId: string) => {
    try {
      await updateDoc(doc(db, "friendRequests", requestId), {
        status: "accepted"
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `friendRequests/${requestId}`);
    }
  };

  const saveUsername = async () => {
    if (!user || !newUsername) return;
    const usernameLower = newUsername.toLowerCase();
    // Check if username exists
    const q = query(collection(db, "users"), where("username", "==", usernameLower));
    const snapshot = await getDocs(q);
    if (!snapshot.empty) {
      alert("Username already taken");
      return;
    }

    try {
      await updateDoc(doc(db, "users", user.uid), {
        username: usernameLower
      });
      setProfile(prev => prev ? { ...prev, username: usernameLower } : null);
      setIsUsernameModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  const handleLogin = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const handleLogout = async () => {
    await signOut(auth);
    setRoom(null);
    setIsMatching(false);
    socket?.disconnect();
  };

  const updateProfile = async () => {
    if (!user) return;
    try {
      await updateDoc(doc(db, "users", user.uid), {
        displayName: editName,
        bio: editBio,
        gender: editGender,
        country: editCountry,
      });
      setProfile(prev => prev ? { ...prev, displayName: editName, bio: editBio, gender: editGender, country: editCountry } : null);
      setIsProfileModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${user.uid}`);
    }
  };

  // Personal Chat Listener
  useEffect(() => {
    if (!profile?.uid || !selectedFriend?.uid) return;

    const chatId = [profile.uid, selectedFriend.uid].sort().join('_');
    const q = query(
      collection(db, 'chats'),
      where('chatId', '==', chatId),
      orderBy('timestamp', 'asc'),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setPersonalMessages(msgs);
    }, (error) => {
      console.error("Personal chat error:", error);
    });

    return () => unsubscribe();
  }, [profile?.uid, selectedFriend?.uid]);

  const sendPersonalMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!personalInput.trim() || !profile?.uid || !selectedFriend?.uid) return;

    const chatId = [profile.uid, selectedFriend.uid].sort().join('_');
    const encrypted = CryptoJS.AES.encrypt(personalInput, chatId).toString();

    try {
      await addDoc(collection(db, 'chats'), {
        chatId,
        senderId: profile.uid,
        senderName: profile.displayName,
        text: encrypted,
        timestamp: serverTimestamp()
      });
      setPersonalInput("");
    } catch (error) {
      console.error("Error sending personal message:", error);
    }
  };

  const submitPayment = async () => {
    if (!user || !profile) return;
    if (!paymentUTR || !paymentScreenshot) {
      alert("Please provide UTR and Screenshot");
      return;
    }
    try {
      const paymentData = {
        userId: user.uid,
        userEmail: user.email,
        plan: "1 Month Premium",
        amount: Number(paymentAmount),
        utr: paymentUTR,
        screenshotURL: paymentScreenshot,
        status: 'pending',
        createdAt: serverTimestamp(),
      };
      const paymentId = `${user.uid}_${Date.now()}`;
      await setDoc(doc(db, "payments", paymentId), paymentData);
      alert("Payment submitted! Please wait 24 hours for approval.");
      setPaymentUTR("");
      setPaymentScreenshot(null);
      setIsWalletModalOpen(false);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, "payments");
    }
  };

  const approvePayment = async (payment: PaymentRequest) => {
    try {
      const userRef = doc(db, "users", payment.userId);
      await updateDoc(userRef, {
        isPremium: true,
        premiumUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      });
      await updateDoc(doc(db, "payments", payment.id), {
        status: 'approved',
      });
      alert("Payment approved and Premium activated!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${payment.userId}`);
    }
  };

  const rejectPayment = async (paymentId: string) => {
    try {
      await updateDoc(doc(db, "payments", paymentId), {
        status: 'rejected',
      });
      alert("Payment rejected!");
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `payments/${paymentId}`);
    }
  };

  // Video Chat Logic
  const requestMedia = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setMediaError("Your browser does not support video chat. Please use a modern browser like Chrome or Firefox.");
      return null;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: {
          width: { ideal: 1280 },
          height: { ideal: 720 },
          facingMode: "user"
        }, 
        audio: true 
      });
      setLocalStream(stream);
      setMediaError(null);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      return stream;
    } catch (err: any) {
      console.error("Failed to get local stream", err);
      const errorName = err.name || err.toString();
      
      if (errorName === 'NotAllowedError' || errorName === 'PermissionDeniedError' || errorName.includes('denied')) {
        setMediaError("Camera/Mic access denied. Please allow access in your browser settings. If you're in an iframe, make sure the parent allows camera/mic access.");
      } else if (errorName === 'NotFoundError' || errorName === 'DevicesNotFoundError') {
        setMediaError("No camera or microphone found. Please connect your devices and try again.");
      } else if (errorName === 'NotReadableError' || errorName === 'TrackStartError') {
        setMediaError("Your camera or microphone is already in use by another application.");
      } else {
        setMediaError(`Media Error: ${errorName}. Please check your browser settings.`);
      }
      return null;
    }
  };

  useEffect(() => {
    if (!user) return;
    const newSocket = io();
    setSocket(newSocket);

    requestMedia();

    return () => {
      newSocket.disconnect();
      localStream?.getTracks().forEach(track => track.stop());
    };
  }, [user]);

  useEffect(() => {
    if (!socket || !localStream || !user) return;

    socket.on("waiting", () => {
      setIsMatching(true);
      setRoom(null);
      setRemoteStream(null);
      setPeerProfile(null);
      setMessages([]);
      setIsChatAccepted(false);
      setHasSentChatRequest(false);
      setHasReceivedChatRequest(false);
      if (peer) {
        peer.destroy();
        setPeer(null);
      }
    });

    socket.on("matched", ({ room: matchedRoom, peerId, peerProfile: pProfile }) => {
      setIsMatching(false);
      setRoom(matchedRoom);
      setPeerProfile(pProfile);
      setIsChatAccepted(false);
      setHasSentChatRequest(false);
      setHasReceivedChatRequest(false);

      const isInitiator = socket.id! > peerId;
      const newPeer = new Peer({
        initiator: isInitiator,
        trickle: false,
        stream: localStream,
      });

      newPeer.on("signal", (data) => {
        socket.emit("signal", { room: matchedRoom, signal: data });
      });

      newPeer.on("stream", (stream) => {
        setRemoteStream(stream);
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = stream;
        }
      });

      setPeer(newPeer);
    });

    socket.on("signal", (signal) => {
      if (peer) {
        peer.signal(signal);
      }
    });

    socket.on("message", async (data: any) => {
      if (room) {
        try {
          const bytes = CryptoJS.AES.decrypt(data.text, room);
          const decrypted = bytes.toString(CryptoJS.enc.Utf8);
          setMessages((prev) => [...prev, { ...data, text: decrypted || data.text }]);
        } catch (e) {
          setMessages((prev) => [...prev, data]);
        }
      } else {
        setMessages((prev) => [...prev, data]);
      }
    });

    socket.on("chat-request", () => {
      setHasReceivedChatRequest(true);
    });

    socket.on("chat-accepted", () => {
      setIsChatAccepted(true);
    });

    socket.on("peer-left", () => {
      setRemoteStream(null);
      if (peer) {
        peer.destroy();
        setPeer(null);
      }
      handleNext();
    });

    socket.on("online-count", (count) => {
      setOnlineCount(count);
    });

    return () => {
      socket.off("waiting");
      socket.off("matched");
      socket.off("signal");
      socket.off("message");
      socket.off("peer-left");
      socket.off("online-count");
      socket.off("chat-request");
      socket.off("chat-accepted");
    };
  }, [socket, localStream, user, room, autoTranslate, targetLanguage, peer]);

  const translateText = async (text: string, lang: string) => {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: `Translate the following text to ${lang}. Only return the translated text, nothing else: "${text}"`,
      });
      return response.text || text;
    } catch (error) {
      console.error("Translation error:", error);
      return text;
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    personalChatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [personalMessages]);

  // Admin: Fetch pending payments
  useEffect(() => {
    if (profile?.role === 'admin') {
      const path = "payments";
      const q = query(collection(db, path), where("status", "==", "pending"));
      const unsubscribe = onSnapshot(q, (snapshot) => {
        const payments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PaymentRequest));
        setPendingPayments(payments);
      }, (error) => {
        handleFirestoreError(error, OperationType.GET, path);
      });
      return () => unsubscribe();
    }
  }, [profile]);

  const handleJoin = async () => {
    if (mediaError || !localStream) {
      const stream = await requestMedia();
      if (!stream) return;
    }
    socket?.emit("join", { ...displayProfile, genderFilter });
  };

  const handleAcceptChat = () => {
    if (socket && room) {
      socket.emit("chat-accepted", { room });
      setIsChatAccepted(true);
    }
  };

  const handleSendChatRequest = () => {
    if (socket && room) {
      socket.emit("chat-request", { room });
      setHasSentChatRequest(true);
    }
  };

  const handleNext = async () => {
    if (!displayProfile?.isPremium) {
      const newCount = nextCount + 1;
      setNextCount(newCount);
      
      // Show ad every 5 skips for free users
      if (newCount % 5 === 0) {
        setShowAd(true);
        setAdCountdown(5);
        return;
      }
    }
    socket?.emit("next", { room });
    setRemoteStream(null);
    setPeerProfile(null);
    setIsChatAccepted(false);
    setHasSentChatRequest(false);
    setHasReceivedChatRequest(false);
    if (peer) {
      peer.destroy();
      setPeer(null);
    }
  };

  // Ad Countdown Logic
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (showAd && adCountdown > 0) {
      timer = setTimeout(() => setAdCountdown(adCountdown - 1), 1000);
    } else if (showAd && adCountdown === 0) {
      setShowAd(false);
      // Automatically trigger the next match after ad
      socket?.emit("next", { room });
      setRemoteStream(null);
      setPeerProfile(null);
      if (peer) {
        peer.destroy();
        setPeer(null);
      }
    }
    return () => clearTimeout(timer);
  }, [showAd, adCountdown]);

  // Recurring Upsell Popup Logic
  useEffect(() => {
    if (displayProfile?.isPremium || !user) return;

    const interval = setInterval(() => {
      setIsUpsellModalOpen(true);
    }, 180000); // Every 3 minutes

    return () => clearInterval(interval);
  }, [displayProfile?.isPremium, user]);

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim() && room) {
      const encrypted = CryptoJS.AES.encrypt(inputText, room).toString();
      socket?.emit("message", { 
        room, 
        text: encrypted,
        displayName: displayProfile?.displayName || "User",
        isPremium: displayProfile?.isPremium || false
      });
      setInputText("");
    }
  };

  const startPrivateChat = () => {
    if (!displayProfile?.isPremium) {
      alert("Private chat is a Premium feature. Please upgrade to unlock!");
      setIsUpsellModalOpen(true);
      return;
    }
    alert("Private chat initiated (Simulated)");
  };

  const toggleMute = () => {
    if (localStream) {
      localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!isMuted);
    }
  };

  const toggleVideo = () => {
    if (localStream) {
      localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsVideoOff(!isVideoOff);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white p-8 rounded-3xl border border-slate-200 text-center shadow-2xl">
          <div className="w-24 h-24 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-blue-500/20 overflow-hidden">
            <img src={APP_LOGO} alt="vidochat" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <h1 className="text-4xl font-black text-slate-900 mb-2 tracking-tight">vidochat</h1>
          <p className="text-slate-500 mb-8 font-medium">Connect with the world, instantly.</p>
          
          <div className="mb-6 text-left">
            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">
              Select Your Language
            </label>
            <div className="relative group">
              <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-blue-500 transition-colors">
                <Languages size={20} />
              </div>
              <select
                value={targetLanguage}
                onChange={(e) => setTargetLanguage(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-slate-100 border border-slate-200 rounded-2xl text-slate-900 font-bold outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all appearance-none cursor-pointer"
              >
                <option value="English">English (Default)</option>
                <option value="Hindi">Hindi</option>
                <option value="Spanish">Spanish</option>
                <option value="French">French</option>
                <option value="German">German</option>
                <option value="Japanese">Japanese</option>
                <option value="Chinese">Chinese</option>
                <option value="Arabic">Arabic</option>
                <option value="Russian">Russian</option>
                <option value="Portuguese">Portuguese</option>
              </select>
              <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
                <ChevronDown size={16} />
              </div>
            </div>
          </div>
          
          <button
            onClick={handleLogin}
            className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-2xl transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-blue-600/20 flex items-center justify-center gap-3"
          >
            <Zap className="fill-white" size={20} />
            CONTINUE WITH GOOGLE
          </button>
          
          <p className="mt-8 text-[10px] text-slate-400 uppercase tracking-widest font-bold">
            By continuing, you agree to our Terms & Privacy
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden flex flex-col">
      {/* Header */}
      <header className="p-4 border-b border-slate-200 flex items-center justify-between bg-white/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
          <div className="w-10 h-10 bg-blue-500 rounded-full flex items-center justify-center overflow-hidden shadow-lg shadow-blue-500/20">
            <img src={APP_LOGO} alt="logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
          </div>
          <h1 className="text-2xl font-black tracking-tighter text-slate-900 uppercase">vidochat</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={() => setIsSocialModalOpen(true)}
            className="relative p-2 text-slate-600 hover:text-blue-600 transition-colors"
          >
            <Users size={24} />
            {friendRequests.length > 0 && (
              <span className="absolute top-0 right-0 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                {friendRequests.length}
              </span>
            )}
          </button>

          <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-slate-100 rounded-full border border-slate-200">
            <Users size={16} className="text-blue-500" />
            <span className="text-xs font-mono text-slate-600">{onlineCount.toLocaleString()} ONLINE</span>
          </div>

          <button 
            onClick={() => setIsWalletModalOpen(true)}
            className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 border border-yellow-500/30 rounded-full hover:bg-yellow-500/20 transition-all"
          >
            <Zap size={14} className="text-yellow-500 fill-yellow-500" />
            <span className="text-xs font-bold uppercase">{displayProfile?.isPremium ? 'Premium' : 'Get Premium'}</span>
          </button>

          <button
            onClick={toggleFullscreen}
            className="p-2 text-slate-600 hover:text-blue-600 transition-colors"
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
          </button>
          
          <div className="flex items-center gap-3">
            {!displayProfile?.isPremium && (
              <button
                onClick={() => setIsWalletModalOpen(true)}
                className="hidden md:flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-yellow-400 to-orange-500 text-black font-black text-[10px] rounded-full hover:scale-105 transition-all shadow-lg shadow-orange-500/20 uppercase tracking-widest"
              >
                <Zap size={14} className="fill-black" />
                Upgrade to VIP
              </button>
            )}
            {displayProfile?.isPremium && (
              <div className="hidden sm:flex items-center gap-1 px-2 py-0.5 bg-gradient-to-r from-yellow-400 to-orange-500 rounded text-[10px] font-black text-black uppercase tracking-tighter animate-pulse">
                PREMIUM
              </div>
            )}
            <button 
              onClick={() => setIsProfileModalOpen(true)}
              className={`flex items-center gap-2 p-1 pr-3 bg-white/5 rounded-full border ${displayProfile?.isPremium ? 'border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.2)]' : 'border-white/10'} hover:bg-white/10 transition-all`}
            >
              <img src={displayProfile?.photoURL || "https://picsum.photos/seed/user/100/100"} className={`w-8 h-8 rounded-full object-cover ${displayProfile?.isPremium ? 'ring-2 ring-yellow-500' : ''}`} alt="Profile" />
              <span className="text-sm font-medium hidden sm:inline">{displayProfile?.displayName}</span>
            </button>
            <button onClick={handleLogout} className="p-2 text-white/50 hover:text-red-500 transition-colors">
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 relative flex flex-col md:flex-row overflow-hidden">
        {/* Video Area */}
        <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden">
          {/* Remote Video */}
          <div className="absolute inset-0 w-full h-full flex items-center justify-center">
            {remoteStream ? (
              <>
                <video
                  ref={remoteVideoRef}
                  autoPlay
                  playsInline
                  className={`w-full h-full object-cover ${peerProfile?.isPremium ? 'border-4 border-yellow-500/30' : ''}`}
                />
                {/* Peer Info Overlay */}
                <div className="absolute top-6 left-6 flex items-center gap-3 bg-black/40 backdrop-blur-md p-2 pr-4 rounded-full border border-white/10 z-20">
                  <img src={peerProfile?.photoURL || "https://picsum.photos/seed/peer/100/100"} className="w-10 h-10 rounded-full object-cover border border-white/20" alt="Peer" />
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">{peerProfile?.displayName || 'Stranger'}</span>
                      {peerProfile?.isPremium && (
                        <span className="px-1.5 py-0.5 bg-gradient-to-r from-yellow-400 to-orange-500 rounded text-[8px] font-black text-black uppercase tracking-tighter">
                          PREMIUM
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {peerProfile?.bio && <p className="text-[10px] text-white/50 truncate max-w-[100px]">{peerProfile.bio}</p>}
                      <button 
                        onClick={startPrivateChat}
                        className="px-2 py-0.5 bg-orange-500/20 border border-orange-500/40 rounded text-[8px] font-bold text-orange-500 hover:bg-orange-500 hover:text-white transition-all"
                      >
                        PRIVATE CHAT (50c)
                      </button>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center gap-4 text-white/30">
                {isMatching ? (
                  <>
                    <motion.div
                      animate={{ scale: [1, 1.2, 1], opacity: [0.3, 0.6, 0.3] }}
                      transition={{ duration: 2, repeat: Infinity }}
                      className="w-24 h-24 rounded-full border-4 border-orange-500/30 flex items-center justify-center"
                    >
                      <Users size={48} />
                    </motion.div>
                    <p className="text-sm font-mono tracking-widest uppercase">Finding your next vibe...</p>
                  </>
                ) : (
                  <>
                    <Users size={64} />
                    <p className="text-sm font-mono tracking-widest uppercase">Ready to connect?</p>
                    <button
                      onClick={handleJoin}
                      className={`mt-4 px-8 py-3 font-bold rounded-full transition-all transform hover:scale-105 active:scale-95 shadow-xl ${mediaError ? 'bg-zinc-700 text-white/50' : 'bg-orange-500 hover:bg-orange-600 text-white shadow-orange-500/20'}`}
                    >
                      {mediaError ? 'FIX MEDIA ERROR' : 'START CHATTING'}
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Local Video Preview */}
          <div className={`absolute bottom-6 right-6 w-32 h-48 md:w-48 md:h-64 bg-zinc-900 rounded-2xl overflow-hidden border-2 ${displayProfile?.isPremium ? 'border-yellow-500 shadow-[0_0_30px_rgba(234,179,8,0.3)]' : 'border-white/20'} shadow-2xl z-20`}>
            {mediaError ? (
              <div className="absolute inset-0 bg-zinc-900/90 flex flex-col items-center justify-center p-4 text-center">
                <VideoOff className="text-red-500 mb-2" size={24} />
                <p className="text-[10px] text-white/80 mb-3 leading-tight">{mediaError}</p>
                <button 
                  onClick={requestMedia}
                  className="px-3 py-1 bg-white text-black text-[10px] font-bold rounded-full hover:bg-orange-500 hover:text-white transition-colors"
                >
                  RETRY
                </button>
              </div>
            ) : (
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="w-full h-full object-cover scale-x-[-1]"
              />
            )}
            {isVideoOff && !mediaError && (
              <div className="absolute inset-0 bg-zinc-900 flex items-center justify-center">
                <VideoOff className="text-white/20" size={32} />
              </div>
            )}
            <div className="absolute top-2 right-2 flex gap-1">
              {isMuted && (
                <div className="p-1.5 bg-red-600 rounded-lg shadow-lg">
                  <MicOff size={12} className="text-white" />
                </div>
              )}
              {isVideoOff && (
                <div className="p-1.5 bg-red-600 rounded-lg shadow-lg">
                  <VideoOff size={12} className="text-white" />
                </div>
              )}
            </div>
          </div>

          {/* Controls Overlay */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-4 z-30">
            <div className="flex items-center gap-2 bg-black/40 backdrop-blur-md p-1 rounded-full border border-white/10 mr-4">
              <button 
                onClick={() => setGenderFilter('all')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${genderFilter === 'all' ? 'bg-white text-black' : 'text-white/50 hover:text-white'}`}
              >
                ALL
              </button>
              <button 
                onClick={() => setGenderFilter('male')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${genderFilter === 'male' ? 'bg-blue-500 text-white' : 'text-white/50 hover:text-white'}`}
              >
                MALE
              </button>
              <button 
                onClick={() => setGenderFilter('female')}
                className={`px-3 py-1.5 rounded-full text-[10px] font-bold transition-all ${genderFilter === 'female' ? 'bg-pink-500 text-white' : 'text-white/50 hover:text-white'}`}
              >
                FEMALE
              </button>
            </div>
            <button
              onClick={toggleMute}
              className={`p-4 rounded-full transition-all ${isMuted ? 'bg-red-600 shadow-lg shadow-red-600/20' : 'bg-blue-600 shadow-lg shadow-blue-600/20'} border border-white/20 hover:scale-110 active:scale-95`}
              title={isMuted ? "Unmute Mic" : "Mute Mic"}
            >
              {isMuted ? <MicOff size={24} className="text-white" /> : <Mic size={24} className="text-white" />}
            </button>
            <button
              onClick={toggleVideo}
              className={`p-4 rounded-full transition-all ${isVideoOff ? 'bg-red-600 shadow-lg shadow-red-600/20' : 'bg-green-600 shadow-lg shadow-green-600/20'} border border-white/20 hover:scale-110 active:scale-95`}
              title={isVideoOff ? "Turn Video On" : "Turn Video Off"}
            >
              {isVideoOff ? <VideoOff size={24} className="text-white" /> : <Video size={24} className="text-white" />}
            </button>
            <button
              onClick={handleNext}
              disabled={!room && !isMatching}
              className="px-8 py-4 bg-white text-black font-bold rounded-full hover:bg-orange-500 hover:text-white transition-all flex items-center gap-2 group disabled:opacity-50 disabled:hover:bg-white disabled:hover:text-black shadow-xl"
            >
              NEXT
              <SkipForward size={20} className="group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        </div>

        {/* Chat Sidebar */}
        <div className="w-full md:w-96 bg-[#111] border-l border-white/10 flex flex-col h-64 md:h-auto">
          <div className="p-4 border-b border-white/10 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <MessageSquare size={18} className="text-orange-500" />
              <h2 className="text-sm font-bold uppercase tracking-wider">Live Chat</h2>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 bg-white/5 rounded-lg px-2 py-1 border border-white/10">
                <Languages size={14} className={autoTranslate ? "text-blue-400" : "text-white/40"} />
                <select 
                  value={targetLanguage}
                  onChange={(e) => setTargetLanguage(e.target.value)}
                  className="bg-transparent text-[10px] text-white outline-none cursor-pointer font-bold"
                >
                  <option value="English">EN</option>
                  <option value="Hindi">HI</option>
                  <option value="Spanish">ES</option>
                  <option value="French">FR</option>
                  <option value="German">DE</option>
                  <option value="Japanese">JA</option>
                  <option value="Chinese">ZH</option>
                  <option value="Arabic">AR</option>
                  <option value="Russian">RU</option>
                  <option value="Portuguese">PT</option>
                </select>
              </div>
              <button 
                onClick={() => setAutoTranslate(!autoTranslate)}
                className={`p-1.5 rounded-lg transition-all ${autoTranslate ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-white/5 text-white/40 hover:bg-white/10'}`}
                title={autoTranslate ? "Disable Auto Translate" : "Enable Auto Translate"}
              >
                <Zap size={16} className={autoTranslate ? "animate-pulse" : ""} />
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-4 space-y-4 scrollbar-hide relative">
            {!isChatAccepted && room && (
              <div className="absolute inset-0 z-10 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
                <motion.div
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="w-full"
                >
                  <div className="w-16 h-16 bg-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-blue-500/30 rotate-12">
                    <MessageSquare className="text-blue-500" size={32} />
                  </div>
                  <h3 className="text-lg font-black text-white mb-2 uppercase tracking-tight">Chat Request</h3>
                  <p className="text-white/60 text-[10px] mb-6 leading-relaxed uppercase tracking-widest font-mono">
                    {hasReceivedChatRequest 
                      ? `${peerProfile?.displayName || 'Stranger'} wants to chat!` 
                      : "Send a request to start texting."}
                  </p>
                  
                  {hasReceivedChatRequest ? (
                    <button
                      onClick={handleAcceptChat}
                      className="w-full py-4 bg-blue-600 text-white font-black rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 uppercase tracking-widest text-[10px]"
                    >
                      ACCEPT CHAT
                    </button>
                  ) : (
                    <button
                      onClick={handleSendChatRequest}
                      disabled={hasSentChatRequest}
                      className={`w-full py-4 ${hasSentChatRequest ? 'bg-zinc-800 text-white/30' : 'bg-white text-black hover:bg-blue-600 hover:text-white'} font-black rounded-2xl transition-all uppercase tracking-widest text-[10px]`}
                    >
                      {hasSentChatRequest ? 'REQUEST SENT' : 'SAY HI 👋'}
                    </button>
                  )}
                </motion.div>
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((msg, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex flex-col ${msg.userId === socket?.id ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center gap-1 mb-1 px-1">
                    <span className="text-[10px] text-white/30 uppercase font-mono">
                      {msg.displayName || 'Stranger'}
                    </span>
                    {msg.isPremium && (
                      <span className="px-1 py-0.5 bg-gradient-to-r from-yellow-400 to-orange-500 rounded text-[6px] font-black text-black uppercase tracking-tighter">
                        PREMIUM
                      </span>
                    )}
                  </div>
                  <div className={`max-w-[80%] p-3 rounded-2xl text-sm ${
                    msg.userId === socket?.id 
                      ? 'bg-orange-500 text-white rounded-tr-none' 
                      : 'bg-white/10 text-white rounded-tl-none'
                  }`}>
                    <TranslatedMessage 
                      text={msg.text} 
                      targetLang={targetLanguage} 
                      isOwn={msg.userId === socket?.id} 
                      translateFn={translateText}
                      autoTranslate={autoTranslate}
                    />
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            <div ref={chatEndRef} />
          </div>

          <form onSubmit={sendMessage} className="p-4 border-t border-white/10 flex gap-2">
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              disabled={!isChatAccepted}
              placeholder={isChatAccepted ? "Type a message..." : "Chat locked"}
              className="flex-1 bg-white/5 border border-white/10 rounded-full px-4 py-2 text-sm focus:outline-none focus:border-orange-500 transition-colors disabled:opacity-20"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || !room || !isChatAccepted}
              className="p-2 bg-orange-500 text-white rounded-full hover:bg-orange-600 transition-colors disabled:opacity-50"
            >
              <Send size={18} />
            </button>
          </form>
        </div>
      </main>

      {/* VIP Upgrade Popup */}
      <AnimatePresence>
        {isVIPPopupOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              className="max-w-sm w-full bg-white border border-blue-100 rounded-3xl p-8 text-center shadow-2xl"
            >
              <div className="w-20 h-20 bg-blue-500 rounded-full flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-500/20">
                <Zap size={40} className="text-white fill-white" />
              </div>
              <h2 className="text-2xl font-black text-slate-900 mb-2 uppercase tracking-tight">Upgrade to VIP</h2>
              <p className="text-slate-500 text-sm mb-8 leading-relaxed">
                Tired of ads? Want to skip unlimited strangers? Get <span className="text-blue-600 font-bold">VIP status</span> now and stand out with a blue badge!
              </p>
              <div className="space-y-3">
                <button
                  onClick={() => {
                    setIsVIPPopupOpen(false);
                    setIsWalletModalOpen(true);
                  }}
                  className="w-full py-4 bg-blue-600 text-white font-black rounded-full hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 uppercase tracking-widest text-xs"
                >
                  GET VIP NOW - ₹89
                </button>
                <button
                  onClick={() => setIsVIPPopupOpen(false)}
                  className="w-full py-4 bg-slate-100 text-slate-400 font-bold rounded-full hover:bg-slate-200 transition-all text-xs uppercase tracking-widest"
                >
                  Maybe Later
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {isProfileModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold flex items-center gap-2 text-slate-900">
                  <User size={24} className="text-blue-500" />
                  Profile Settings
                </h2>
                <button onClick={() => setIsProfileModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  ✕
                </button>
              </div>

              <div className="space-y-6">
                <div className="flex flex-col items-center gap-4">
                  <div className="relative group">
                    <img src={profile?.photoURL || "https://picsum.photos/seed/user/100/100"} className="w-24 h-24 rounded-full object-cover border-2 border-blue-500" alt="Avatar" />
                    <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                      <Camera size={24} className="text-white" />
                    </div>
                  </div>
                  {profile?.premiumUntil && (
                    <p className="text-[10px] text-blue-600 font-mono uppercase">Expires: {profile.premiumUntil.toDate ? profile.premiumUntil.toDate().toLocaleDateString() : new Date(profile.premiumUntil).toLocaleDateString()}</p>
                  )}
                  <p className="text-xs text-slate-400 uppercase font-mono">Avatar synced with Google</p>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-mono text-slate-500 uppercase">Display Name</label>
                  <input
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 outline-none transition-colors"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-mono text-slate-500 uppercase">Bio</label>
                  <textarea
                    value={editBio}
                    onChange={(e) => setEditBio(e.target.value)}
                    rows={3}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 outline-none transition-colors resize-none"
                    placeholder="Tell the world about your vibe..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-mono text-slate-500 uppercase">Gender</label>
                    <select
                      value={editGender}
                      onChange={(e) => setEditGender(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 outline-none transition-colors"
                    >
                      <option value="">Select Gender</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-mono text-slate-500 uppercase">Country</label>
                    <input
                      type="text"
                      value={editCountry}
                      onChange={(e) => setEditCountry(e.target.value)}
                      placeholder="e.g. India"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 outline-none transition-colors"
                    />
                  </div>
                </div>

                {!displayProfile?.isPremium ? (
                  <div className="p-4 bg-blue-50 border border-blue-100 rounded-2xl">
                    <h3 className="text-sm font-bold text-blue-600 mb-1 flex items-center gap-2">
                      <Zap size={14} className="fill-blue-600" />
                      GO PREMIUM
                    </h3>
                    <p className="text-[11px] text-slate-600 mb-3 leading-relaxed">
                      Unlock exclusive badges, priority matching, and a blue profile border.
                    </p>
                    <button
                      onClick={() => setIsDemoPremium(true)}
                      className="w-full py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg transition-all"
                    >
                      SIMULATE UPGRADE (DEMO)
                    </button>
                  </div>
                ) : (
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Zap size={14} className="text-blue-600 fill-blue-600" />
                      <span className="text-xs font-bold text-blue-600 uppercase">Premium Active</span>
                    </div>
                    <button onClick={() => setIsDemoPremium(false)} className="text-[10px] text-slate-400 hover:text-slate-600 underline uppercase">
                      Reset Demo
                    </button>
                  </div>
                )}

                <button
                  onClick={updateProfile}
                  className="w-full py-4 bg-blue-600 text-white font-bold rounded-full hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
                >
                  SAVE CHANGES
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Wallet Modal */}
      <AnimatePresence>
        {isWalletModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="max-w-md w-full bg-white border border-slate-200 rounded-3xl p-8 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold flex items-center gap-2 text-slate-900">
                  <Zap size={24} className="text-blue-500 fill-blue-500" />
                  Upgrade to VIP
                </h2>
                <button onClick={() => setIsWalletModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  ✕
                </button>
              </div>

              <div className="space-y-6">
                <div className="p-6 bg-blue-50 border border-blue-100 rounded-2xl text-center">
                  <p className="text-xs text-slate-500 uppercase font-mono mb-1">Current Status</p>
                  <p className="text-2xl font-black text-blue-600 uppercase">{displayProfile?.isPremium ? 'Premium Active' : 'Free User'}</p>
                </div>

                {userPendingPayment ? (
                  <div className="p-6 bg-blue-50 border border-blue-200 rounded-2xl text-center space-y-2">
                    <div className="flex items-center justify-center gap-2 text-blue-600">
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 2, repeat: Infinity, ease: "linear" }}>
                        <Settings size={20} />
                      </motion.div>
                      <span className="font-bold uppercase text-sm">Payment Pending</span>
                    </div>
                    <p className="text-xs text-slate-600 leading-relaxed">
                      We've received your request. Please wait up to <span className="text-slate-900 font-bold">24 hours</span> for manual verification and activation.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-slate-900">Scan QR to Pay</h3>
                    <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center">
                      <div className="w-48 h-48 bg-white p-2 rounded-xl border border-slate-200 mb-4">
                        <img src={PAYMENT_QR} alt="QR Code" className="w-full h-full object-contain" referrerPolicy="no-referrer" />
                      </div>
                      <div className="flex justify-between items-center w-full">
                        <p className="text-xs text-slate-500">Amount:</p>
                        <p className="text-lg font-black text-blue-600">₹{paymentAmount}</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <input
                        type="text"
                        value={paymentUTR}
                        onChange={(e) => setPaymentUTR(e.target.value)}
                        placeholder="Enter UTR / Transaction ID"
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 focus:border-blue-500 outline-none transition-colors text-sm"
                      />
                      <div className="space-y-1">
                        <label className="text-[10px] font-mono text-slate-400 uppercase ml-1">Upload Screenshot</label>
                        <div className="relative">
                          <input
                            type="file"
                            accept="image/*"
                            onChange={handleScreenshotUpload}
                            className="hidden"
                            id="screenshot-upload"
                          />
                          <label
                            htmlFor="screenshot-upload"
                            className="w-full h-12 bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center gap-2 cursor-pointer hover:border-blue-500 transition-colors"
                          >
                            <Camera size={16} className="text-slate-400" />
                            <span className="text-xs text-slate-500 font-medium">
                              {paymentScreenshot ? 'Screenshot Selected' : 'Choose Screenshot'}
                            </span>
                          </label>
                        </div>
                      </div>
                    </div>

                    <button
                      onClick={submitPayment}
                      disabled={displayProfile?.isPremium || !paymentUTR || !paymentScreenshot}
                      className="w-full py-4 bg-blue-600 text-white font-bold rounded-full hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 disabled:opacity-50 disabled:hover:bg-blue-600"
                    >
                      {displayProfile?.isPremium ? 'ALREADY PREMIUM' : 'SUBMIT FOR APPROVAL'}
                    </button>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Admin Modal */}
      <AnimatePresence>
        {isAdminModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="max-w-4xl w-full bg-zinc-900 border border-white/10 rounded-3xl p-8 max-h-[80vh] overflow-y-auto"
            >
              <div className="flex items-center justify-between mb-8">
                <h2 className="text-2xl font-bold flex items-center gap-2">
                  <Settings size={24} className="text-red-500" />
                  Admin Panel - Payments
                </h2>
                <button onClick={() => setIsAdminModalOpen(false)} className="text-white/50 hover:text-white">
                  ✕
                </button>
              </div>

              <div className="space-y-4">
                {pendingPayments.length === 0 ? (
                  <p className="text-center text-white/30 py-12">No pending payments.</p>
                ) : (
                  pendingPayments.map(payment => (
                    <div key={payment.id} className="p-4 bg-white/5 border border-white/10 rounded-2xl flex flex-col md:flex-row gap-4 items-center">
                      <div className="flex-1">
                        <p className="text-xs text-white/50 font-mono">{payment.userEmail}</p>
                        <p className="text-lg font-bold">₹{payment.amount}</p>
                        <p className="text-xs text-orange-500 font-mono">UTR: {payment.utr}</p>
                      </div>
                      <div className="w-32 h-20 bg-black rounded-lg overflow-hidden border border-white/10 cursor-pointer" onClick={() => window.open(payment.screenshotURL)}>
                        <img src={payment.screenshotURL} className="w-full h-full object-cover" alt="Proof" />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => approvePayment(payment)}
                          className="px-6 py-2 bg-green-500 text-white font-bold rounded-lg hover:bg-green-600 transition-all text-xs"
                        >
                          APPROVE PREMIUM
                        </button>
                        <button
                          onClick={() => rejectPayment(payment.id)}
                          className="px-6 py-2 bg-red-500 text-white font-bold rounded-lg hover:bg-red-600 transition-all text-xs"
                        >
                          REJECT
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Upsell Modal */}
      <AnimatePresence>
        {isUpsellModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/90 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, y: 50, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 50, scale: 0.9 }}
              className="max-w-md w-full bg-zinc-900 border border-yellow-500/30 rounded-[2.5rem] p-10 relative overflow-hidden shadow-[0_0_50px_rgba(234,179,8,0.15)]"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-yellow-500 to-transparent opacity-50" />
              
              <button 
                onClick={() => setIsUpsellModalOpen(false)} 
                className="absolute top-6 right-6 text-white/30 hover:text-white transition-colors"
              >
                ✕
              </button>

              <div className="text-center space-y-6">
                <div className="w-20 h-20 bg-gradient-to-br from-yellow-400 to-orange-600 rounded-3xl flex items-center justify-center mx-auto rotate-12 shadow-2xl shadow-yellow-500/20">
                  <Zap className="text-black fill-black" size={40} />
                </div>

                <div className="space-y-2">
                  <h2 className="text-3xl font-black italic tracking-tighter uppercase leading-none">Unlock The Full Vibe</h2>
                  <p className="text-white/50 text-sm">Experience VibeSync without limits.</p>
                </div>

                <div className="grid grid-cols-1 gap-3 text-left py-4">
                  {[
                    { icon: <Zap size={14} />, text: "Zero Ads & Interruptions" },
                    { icon: <SkipForward size={14} />, text: "Unlimited Free Skips" },
                    { icon: <Users size={14} />, text: "Free Gender Filtering" },
                    { icon: <Zap size={14} />, text: "Golden Profile Border" },
                    { icon: <Zap size={14} />, text: "Exclusive Premium Badge" },
                    { icon: <Zap size={14} />, text: "Priority Matchmaking" }
                  ].map((feature, i) => (
                    <div key={i} className="flex items-center gap-3 text-xs font-medium text-white/80 bg-white/5 p-3 rounded-2xl border border-white/5">
                      <div className="text-yellow-500">{feature.icon}</div>
                      {feature.text}
                    </div>
                  ))}
                </div>

                <div className="space-y-4 pt-2">
                  <button
                    onClick={() => {
                      setIsUpsellModalOpen(false);
                      setIsWalletModalOpen(true);
                    }}
                    className="w-full py-5 bg-yellow-500 text-black font-black rounded-full hover:bg-yellow-600 transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-xl shadow-yellow-500/20 uppercase tracking-widest text-sm"
                  >
                    Upgrade for 89 Coins
                  </button>
                  <button 
                    onClick={() => setIsUpsellModalOpen(false)}
                    className="text-[10px] text-white/30 hover:text-white uppercase tracking-widest font-bold transition-colors"
                  >
                    Maybe Later
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Ad Overlay */}
      <AnimatePresence>
        {showAd && (
          <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-8 text-center">
            <div className="max-w-md w-full space-y-8">
              <div className="relative">
                <div className="w-24 h-24 bg-orange-500/20 rounded-full flex items-center justify-center mx-auto animate-pulse">
                  <Zap className="text-orange-500 fill-orange-500" size={48} />
                </div>
                <div className="absolute -top-2 -right-2 bg-white text-black px-2 py-1 rounded text-[10px] font-bold">AD BREAK</div>
              </div>
              
              <div className="space-y-4">
                <h2 className="text-3xl font-black italic tracking-tighter">TIRED OF ADS?</h2>
                <p className="text-white/50 text-sm leading-relaxed">
                  Go Premium for just <span className="text-yellow-500 font-bold">89 Coins</span> and enjoy uninterrupted vibes with zero ads and unlimited skips!
                </p>
              </div>

              <div className="p-6 bg-white/5 border border-white/10 rounded-3xl">
                <p className="text-xs text-white/30 uppercase font-mono mb-4">Ad ends in</p>
                <div className="text-6xl font-black text-orange-500 tabular-nums">{adCountdown}</div>
              </div>

              <button 
                onClick={() => {
                  setIsWalletModalOpen(true);
                  setShowAd(false);
                }}
                className="w-full py-4 bg-yellow-500 text-black font-black rounded-full hover:bg-yellow-600 transition-all"
              >
                UPGRADE TO PREMIUM
              </button>
            </div>
          </div>
        )}
      </AnimatePresence>

      {/* Social Modal */}
      <AnimatePresence>
        {isSocialModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-white/90 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="max-w-5xl w-full bg-white border border-slate-200 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col md:flex-row h-[85vh] max-h-[800px]"
            >
              <div className={`w-full md:w-80 border-r border-slate-100 flex flex-col bg-slate-50/50 ${selectedFriend ? 'hidden md:flex' : 'flex'} h-full`}>
                <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-white">
                  <div className="flex items-center gap-2">
                    <MessageSquare size={24} className="text-blue-600" />
                    <h2 className="text-xl font-black text-slate-900 tracking-tight uppercase">Inbox</h2>
                  </div>
                  <button onClick={() => setIsSocialModalOpen(false)} className="md:hidden p-2 hover:bg-slate-100 rounded-full transition-colors">
                    <X size={20} />
                  </button>
                </div>

                <div className="p-4 bg-white border-b border-slate-100">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                    <input
                      type="text"
                      placeholder="Search users..."
                      value={searchUsername}
                      onChange={(e) => setSearchUsername(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                      className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar">
                  {/* Search Results */}
                  {searchResults.length > 0 && (
                    <div className="p-4 border-b border-slate-100 bg-blue-50/30">
                      <h3 className="text-[10px] font-black text-blue-600 uppercase tracking-widest mb-3 px-2">Search Results</h3>
                      <div className="space-y-2">
                        {searchResults.map(u => (
                          <div 
                            key={u.uid} 
                            onClick={() => sendFriendRequest(u)}
                            className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:shadow-md transition-all group"
                          >
                            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center overflow-hidden border border-blue-200">
                              {u.photoURL ? <img src={u.photoURL} alt="" className="w-full h-full object-cover" /> : <User className="text-blue-500" size={20} />}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-bold text-slate-900 truncate">{u.displayName}</p>
                              <p className="text-[10px] text-slate-500 truncate">@{u.username}</p>
                            </div>
                            <UserPlus size={16} className="text-blue-500 group-hover:scale-110 transition-transform" />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Friend Requests */}
                  {friendRequests.length > 0 && (
                    <div className="p-4 border-b border-slate-100 bg-orange-50/30">
                      <h3 className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-3 px-2">Friend Requests</h3>
                      <div className="space-y-2">
                        {friendRequests.map(req => (
                          <div key={req.id} className="flex items-center justify-between p-3 bg-white border border-orange-100 rounded-xl shadow-sm">
                            <div className="flex-1 min-w-0 mr-2">
                              <p className="text-xs font-bold text-slate-900 truncate">{req.fromName}</p>
                              <p className="text-[10px] text-slate-500">wants to be friends</p>
                            </div>
                            <button 
                              onClick={() => acceptFriendRequest(req.id)}
                              className="px-3 py-1.5 bg-orange-500 text-white text-[10px] font-black rounded-lg hover:bg-orange-600 transition-all shadow-sm"
                            >
                              ACCEPT
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Friends List */}
                  <div className="p-4">
                    <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3 px-2">Friends</h3>
                    <div className="space-y-1">
                      {friends.length === 0 && !searchResults.length && (
                        <div className="text-center py-12">
                          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Users size={32} className="text-slate-300" />
                          </div>
                          <p className="text-sm font-bold text-slate-900">No friends yet</p>
                          <p className="text-xs text-slate-400 mt-1">Search for users to connect!</p>
                        </div>
                      )}
                      {friends.map(f => (
                        <div 
                          key={f.uid}
                          onClick={() => setSelectedFriend(f)}
                          className={`flex items-center gap-3 p-3 rounded-2xl cursor-pointer transition-all ${selectedFriend?.uid === f.uid ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'hover:bg-white border border-transparent hover:border-slate-200'}`}
                        >
                          <div className="relative flex-shrink-0">
                            <div className={`w-12 h-12 rounded-full flex items-center justify-center overflow-hidden border-2 ${selectedFriend?.uid === f.uid ? 'border-white/50' : 'border-blue-100 bg-blue-50'}`}>
                              {f.photoURL ? <img src={f.photoURL} alt="" className="w-full h-full object-cover" /> : <User className={selectedFriend?.uid === f.uid ? "text-white" : "text-blue-500"} size={24} />}
                            </div>
                            <div className="absolute bottom-0 right-0 w-3.5 h-3.5 bg-green-500 border-2 border-white rounded-full"></div>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-sm font-bold truncate ${selectedFriend?.uid === f.uid ? 'text-white' : 'text-slate-900'}`}>{f.displayName}</p>
                            <p className={`text-[10px] truncate ${selectedFriend?.uid === f.uid ? 'text-white/70' : 'text-slate-500'}`}>Active now</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>


              {/* Chat Area */}
              <div className={`flex-1 flex flex-col bg-white ${!selectedFriend ? 'hidden md:flex items-center justify-center' : 'flex'}`}>
                {selectedFriend ? (
                  <>
                    {/* Chat Header */}
                    <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white/80 backdrop-blur-md sticky top-0 z-10">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setSelectedFriend(null)} className="md:hidden p-2 hover:bg-slate-100 rounded-full transition-colors">
                          <ChevronLeft size={20} />
                        </button>
                        <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center overflow-hidden border border-blue-200">
                          {selectedFriend.photoURL ? <img src={selectedFriend.photoURL} alt="" className="w-full h-full object-cover" /> : <User className="text-blue-500" size={20} />}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-slate-900 leading-none">{selectedFriend.displayName}</p>
                          <p className="text-[10px] text-green-500 font-bold mt-1 uppercase tracking-tighter">Online</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="hidden sm:flex items-center gap-1 bg-slate-100 rounded-lg px-2 py-1 border border-slate-200">
                          <Languages size={14} className={autoTranslate ? "text-blue-600" : "text-slate-400"} />
                          <select 
                            value={targetLanguage}
                            onChange={(e) => setTargetLanguage(e.target.value)}
                            className="bg-transparent text-[10px] text-slate-900 outline-none cursor-pointer font-bold"
                          >
                            <option value="English">EN</option>
                            <option value="Hindi">HI</option>
                            <option value="Spanish">ES</option>
                            <option value="French">FR</option>
                            <option value="German">DE</option>
                            <option value="Japanese">JA</option>
                            <option value="Chinese">ZH</option>
                            <option value="Arabic">AR</option>
                            <option value="Russian">RU</option>
                            <option value="Portuguese">PT</option>
                          </select>
                        </div>
                        <button 
                          onClick={() => setAutoTranslate(!autoTranslate)}
                          className={`p-2 rounded-full transition-all ${autoTranslate ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20' : 'bg-slate-100 text-slate-400 hover:bg-slate-200'}`}
                        >
                          <Zap size={18} className={autoTranslate ? "animate-pulse" : ""} />
                        </button>
                        <button onClick={() => setIsSocialModalOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                          <X size={20} className="text-slate-400" />
                        </button>
                      </div>
                    </div>

                    {/* Messages Area */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-slate-50/30">
                      <div className="flex flex-col items-center justify-center py-10 text-center">
                        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center overflow-hidden border-4 border-white shadow-xl mb-4">
                          {selectedFriend.photoURL ? <img src={selectedFriend.photoURL} alt="" className="w-full h-full object-cover" /> : <User className="text-blue-500" size={40} />}
                        </div>
                        <h4 className="text-lg font-black text-slate-900">{selectedFriend.displayName}</h4>
                        <p className="text-xs text-slate-500 mb-4">@{selectedFriend.username} • Vidochat Friend</p>
                        <button className="px-4 py-1.5 bg-slate-100 text-slate-900 text-xs font-bold rounded-lg hover:bg-slate-200 transition-all">
                          View Profile
                        </button>
                      </div>

                      {personalMessages.map((msg: any, idx: number) => {
                        let decrypted = "Encrypted Message";
                        try {
                          const chatId = [profile?.uid, selectedFriend.uid].sort().join('_');
                          const bytes = CryptoJS.AES.decrypt(msg.text, chatId);
                          decrypted = bytes.toString(CryptoJS.enc.Utf8) || "Encrypted Message";
                        } catch (e) {}

                        const isOwn = msg.senderId === profile?.uid;
                        const showAvatar = idx === 0 || personalMessages[idx-1].senderId !== msg.senderId;

                        return (
                          <div key={msg.id} className={`flex ${isOwn ? 'justify-end' : 'justify-start'} items-end gap-2`}>
                            {!isOwn && (
                              <div className="w-7 h-7 rounded-full overflow-hidden flex-shrink-0 mb-1">
                                {showAvatar ? (
                                  selectedFriend.photoURL ? <img src={selectedFriend.photoURL} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full bg-slate-200 flex items-center justify-center"><User size={14} className="text-slate-400" /></div>
                                ) : <div className="w-7" />}
                              </div>
                            )}
                            <div className={`max-w-[70%] p-3 rounded-2xl text-sm shadow-sm ${
                              isOwn 
                                ? 'bg-blue-600 text-white rounded-br-none' 
                                : 'bg-white text-slate-900 border border-slate-100 rounded-bl-none'
                            }`}>
                              <TranslatedMessage 
                                text={decrypted} 
                                targetLang={targetLanguage} 
                                isOwn={isOwn} 
                                translateFn={translateText} 
                                autoTranslate={autoTranslate}
                              />
                            </div>
                          </div>
                        );
                      })}
                      <div ref={personalChatEndRef} />
                    </div>

                    {/* Chat Input */}
                    <div className="p-4 bg-white border-t border-slate-100">
                      <form onSubmit={sendPersonalMessage} className="flex items-center gap-2 bg-slate-100 rounded-[2rem] px-4 py-2 border border-slate-200 focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-500/5 transition-all">
                        <button type="button" className="p-2 text-slate-400 hover:text-blue-500 transition-colors">
                          <Camera size={20} />
                        </button>
                        <input
                          type="text"
                          value={personalInput}
                          onChange={(e) => setPersonalInput(e.target.value)}
                          placeholder="Message..."
                          className="flex-1 bg-transparent border-none py-2 text-sm focus:outline-none text-slate-900 font-medium"
                        />
                        {personalInput.trim() ? (
                          <button
                            type="submit"
                            className="px-4 py-2 text-blue-600 font-bold text-sm hover:text-blue-700 transition-colors"
                          >
                            Send
                          </button>
                        ) : (
                          <div className="flex items-center gap-2">
                            <button type="button" className="p-2 text-slate-400 hover:text-blue-500 transition-colors">
                              <Mic size={20} />
                            </button>
                            <button type="button" className="p-2 text-slate-400 hover:text-blue-500 transition-colors">
                              <Zap size={20} />
                            </button>
                          </div>
                        )}
                      </form>
                    </div>
                  </>
                ) : (
                  <div className="relative flex-1 flex flex-col items-center justify-center p-10 text-center">
                    <button 
                      onClick={() => setIsSocialModalOpen(false)} 
                      className="absolute top-6 right-6 p-2 hover:bg-slate-100 rounded-full transition-colors hidden md:block"
                    >
                      <X size={20} className="text-slate-400" />
                    </button>
                    <div className="max-w-xs">
                      <div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6 border-2 border-blue-100">
                        <MessageSquare size={48} className="text-blue-500 opacity-20" />
                      </div>
                      <h3 className="text-xl font-black text-slate-900 mb-2">Your Messages</h3>
                      <p className="text-sm text-slate-500 mb-8">Send private photos and messages to a friend.</p>
                      <button 
                        onClick={() => {}} // Could trigger search focus
                        className="px-6 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20"
                      >
                        Send Message
                      </button>
                    </div>
                  </div>
                )}
        </motion.div>
      </div>
    )}
  </AnimatePresence>

      {/* Username Modal */}
      <AnimatePresence>
        {isUsernameModalOpen && (
          <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-white/95 backdrop-blur-xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="max-w-md w-full bg-white p-10 rounded-[3.5rem] border border-slate-200 shadow-2xl text-center relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-400 via-purple-500 to-pink-500" />
              
              <div className="w-24 h-24 bg-slate-50 rounded-[2.5rem] flex items-center justify-center mx-auto mb-8 border border-slate-100 shadow-inner">
                <img src={APP_LOGO} alt="logo" className="w-16 h-16 object-contain" referrerPolicy="no-referrer" />
              </div>
              
              <h2 className="text-4xl font-black text-slate-900 mb-2 tracking-tighter leading-none">CHOOSE YOUR<br/>VIBE NAME</h2>
              <p className="text-slate-500 text-sm mb-10 font-medium">This is how your friends will find you.</p>
              
              <div className="space-y-6">
                <div className="relative group">
                  <span className="absolute left-6 top-1/2 -translate-y-1/2 text-blue-500 font-black text-xl group-focus-within:scale-110 transition-transform">@</span>
                  <input
                    type="text"
                    placeholder="username"
                    value={newUsername}
                    onChange={(e) => setNewUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    className="w-full pl-12 pr-6 py-6 bg-slate-50 border-2 border-slate-100 rounded-[2rem] focus:outline-none focus:border-blue-500 focus:bg-white text-slate-900 font-black text-xl transition-all"
                  />
                </div>
                
                <div className="space-y-3">
                  <button
                    onClick={saveUsername}
                    disabled={newUsername.length < 3}
                    className="w-full py-6 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-black rounded-[2rem] transition-all shadow-2xl shadow-blue-600/30 uppercase tracking-widest text-sm"
                  >
                    CREATE ACCOUNT
                  </button>
                  <p className="text-[10px] text-slate-400 font-mono uppercase tracking-widest">
                    By continuing, you agree to our terms
                  </p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Footer / Status */}
      <footer className="p-2 bg-black text-[10px] text-white/20 text-center font-mono uppercase tracking-[0.2em]">
        End-to-end encrypted • Global connection active • {socket?.id || 'DISCONNECTED'}
      </footer>
    </div>
  );
}
