import React, { useState, useEffect, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  doc,
  setDoc,
  getDoc,
  collection,
  onSnapshot,
  runTransaction,
  Timestamp
} from 'firebase/firestore';
import {
  getAuth,
  onAuthStateChanged,
  updateProfile,
  RecaptchaVerifier,
  signInWithPhoneNumber,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  linkWithCredential,
  EmailAuthProvider
} from 'firebase/auth';

// ----------------------------------------------------------------------
// Configurazione Firebase e Inizializzazione
// ----------------------------------------------------------------------
// Import the functions you need from the SDKs you need

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBrHDgr3EAZk8SXzO2pl9L11syZeotZb4k",
  authDomain: "corfu-bets.firebaseapp.com",
  projectId: "corfu-bets",
  storageBucket: "corfu-bets.firebasestorage.app",
  messagingSenderId: "138211240806",
  appId: "1:138211240806:web:af30a2edbc8014c47776a7"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'corfu-bets-id';

// Collezioni strutturate secondo le "STRICT PATHS" (Regola 1)
const getUsersCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'users');
const getMarketsCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'markets');
const getWagersCollection = () => collection(db, 'artifacts', appId, 'public', 'data', 'wagers');

export default function App() {
  const [user, setUser] = useState(null);
  const [userData, setUserData] = useState(null);
  
  // Stati di autenticazione
  const [authTab, setAuthTab] = useState('login'); // 'login' | 'register'
  const [phone, setPhone] = useState('');
  const [verificationCode, setVerificationCode] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [registerStep, setRegisterStep] = useState(1); // 1: Telefono, 2: OTP, 3: Username/Password
  
  // Firebase Recaptcha e Conferma Risultato SMS
  const [confirmationResult, setConfirmationResult] = useState(null);
  const recaptchaVerifierRef = useRef(null);

  // Stati dei dati scommesse
  const [markets, setMarkets] = useState([]);
  const [myWagers, setMyWagers] = useState([]);
  const [allWagers, setAllWagers] = useState([]); 
  const [allUsers, setAllUsers] = useState([]); 
  
  // Navigazione interna dell'app
  const [activeTab, setActiveTab] = useState('active-markets'); 
  
  // Stati di UI & Caricamento
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  
  // Stato form nuova scommessa
  const [newMarket, setNewMarket] = useState({
    title: '',
    optionA: '',
    optionB: '',
    isPreVacation: false,
    freezeHours: ''
  });

  const showToast = (message, isError = false) => {
    if (isError) {
      setErrorMsg(message);
      setTimeout(() => setErrorMsg(null), 5000);
    } else {
      setSuccessMsg(message);
      setTimeout(() => setSuccessMsg(null), 4000);
    }
  };

  // ----------------------------------------------------------------------
  // 1. GESTIONE STATO DI AUTENTICAZIONE (Regola 3)
  // ----------------------------------------------------------------------
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      if (!firebaseUser) {
        setUserData(null);
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, []);

  // Ascolta i dati dell'utente dal documento Firestore dedicato
  useEffect(() => {
    if (!user) return;

    const userDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
    const unsubscribe = onSnapshot(userDocRef, (docSnap) => {
      if (docSnap.exists()) {
        setUserData(docSnap.data());
      } else {
        // Se l'utente è loggato ma non ha ancora salvato il profilo (es. fase di registrazione interrotta)
        setUserData(null);
      }
      setLoading(false);
    }, (err) => {
      console.error("Errore lettura dati utente:", err);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  // Inizializzazione di Recaptcha Invisibile per l'SMS
  const initRecaptcha = () => {
    if (recaptchaVerifierRef.current) return;
    try {
      recaptchaVerifierRef.current = new RecaptchaVerifier(auth, 'recaptcha-container', {
        size: 'invisible',
        callback: () => {}
      });
    } catch (err) {
      console.error("Errore inizializzazione Recaptcha:", err);
    }
  };

  // ----------------------------------------------------------------------
  // 2. LOGICHE DI SIGN-UP (TELEFONO -> SMS -> USERNAME/PASSWORD)
  // ----------------------------------------------------------------------
  
  // Step 1: Invia l'SMS di verifica
  const handleSendSMS = async (e) => {
    e.preventDefault();
    if (!phone.trim()) return;
    
    setTxLoading(true);
    initRecaptcha();

    try {
      const appVerifier = recaptchaVerifierRef.current;
      const confirmation = await signInWithPhoneNumber(auth, phone.trim(), appVerifier);
      setConfirmationResult(confirmation);
      setRegisterStep(2);
      showToast("Codice OTP inviato tramite SMS!");
    } catch (err) {
      console.error("Errore invio SMS:", err);
      showToast("Errore di invio SMS. Controlla il formato del numero (es: +393331234567).", true);
      if (recaptchaVerifierRef.current) {
        recaptchaVerifierRef.current.clear();
        recaptchaVerifierRef.current = null;
      }
    } finally {
      setTxLoading(false);
    }
  };

  // Step 2: Verifica il codice OTP ricevuto
  const handleVerifyOTP = async (e) => {
    e.preventDefault();
    if (!verificationCode.trim() || !confirmationResult) return;

    setTxLoading(true);
    try {
      await confirmationResult.confirm(verificationCode.trim());
      setRegisterStep(3);
      showToast("Numero verificato! Imposta ora le tue credenziali d'accesso.");
    } catch (err) {
      console.error("Errore verifica codice OTP:", err);
      showToast("Codice OTP errato o scaduto.", true);
    } finally {
      setTxLoading(false);
    }
  };

  // Step 3: Associa Username e Password all'account verificato
  const handleSetCredentials = async (e) => {
    e.preventDefault();
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername || password.length < 6) {
      showToast("L'username è obbligatorio e la password deve avere almeno 6 caratteri.", true);
      return;
    }

    setTxLoading(true);
    try {
      const currentFirebaseUser = auth.currentUser;
      if (!currentFirebaseUser) throw new Error("Nessun utente verificato trovato.");

      // Generiamo una mail fittizia per collegare Username/Password standard su Firebase
      const fakeEmail = `${cleanUsername}@corfubets.local`;

      // Creiamo la credenziale email/password per il collegamento
      const credential = EmailAuthProvider.credential(fakeEmail, password);

      // Colleghiamo la credenziale Username/Password all'account telefonico esistente
      await linkWithCredential(currentFirebaseUser, credential);
      await updateProfile(currentFirebaseUser, { displayName: username.trim() });

      // Crea il documento profilo utente su Firestore (con 1000 TK iniziali)
      const userDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', currentFirebaseUser.uid);
      await setDoc(userDocRef, {
        uid: currentFirebaseUser.uid,
        displayName: username.trim(),
        balance: 1000,
        isAdmin: false
      });

      showToast("Registrazione completata con successo!");
      setRegisterStep(1);
      setPhone('');
      setVerificationCode('');
      setUsername('');
      setPassword('');
    } catch (err) {
      console.error("Errore salvataggio credenziali:", err);
      if (err.code === 'auth/email-already-in-use') {
        showToast("Questo Username è già stato preso da un altro amico!", true);
      } else {
        showToast("Errore durante la creazione delle credenziali.", true);
      }
    } finally {
      setTxLoading(false);
    }
  };

  // ----------------------------------------------------------------------
  // 3. LOGICHE DI LOGIN (USERNAME + PASSWORD)
  // ----------------------------------------------------------------------
  const handleLogin = async (e) => {
    e.preventDefault();
    const cleanUsername = username.trim().toLowerCase();
    if (!cleanUsername || !password) return;

    setTxLoading(true);
    try {
      const fakeEmail = `${cleanUsername}@corfubets.local`;
      await signInWithEmailAndPassword(auth, fakeEmail, password);
      showToast("Accesso effettuato con successo!");
      setUsername('');
      setPassword('');
    } catch (err) {
      console.error("Errore durante il login:", err);
      showToast("Username o password errati.", true);
    } finally {
      setTxLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      showToast("Disconnesso.");
    } catch (err) {
      console.error(err);
    }
  };

  // ----------------------------------------------------------------------
  // 4. ASCOLTO DATI FIRESTORE (MERCATI, SCOMMESSE E UTENTI)
  // ----------------------------------------------------------------------
  useEffect(() => {
    if (!user || !userData) return;

    const marketsQuery = getMarketsCollection();
    const unsubscribeMarkets = onSnapshot(marketsQuery, (snapshot) => {
      const list = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      list.sort((a, b) => b.createdAt?.toMillis() - a.createdAt?.toMillis());
      setMarkets(list);
    }, (err) => {
      console.error("Errore caricamento mercati:", err);
    });

    const wagersQuery = getWagersCollection();
    const unsubscribeWagers = onSnapshot(wagersQuery, (snapshot) => {
      const list = [];
      snapshot.forEach((doc) => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setAllWagers(list);
      const mine = list.filter(w => w.userId === user.uid);
      setMyWagers(mine);
    }, (err) => {
      console.error("Errore caricamento giocate:", err);
    });

    const usersQuery = getUsersCollection();
    const unsubscribeUsers = onSnapshot(usersQuery, (snapshot) => {
      const list = [];
      snapshot.forEach((doc) => {
        list.push(doc.data());
      });
      setAllUsers(list);
    }, (err) => {
      console.error("Errore caricamento utenti:", err);
    });

    return () => {
      unsubscribeMarkets();
      unsubscribeWagers();
      unsubscribeUsers();
    };
  }, [user, userData]);

  const makeMeAdmin = async () => {
    if (!user || !userData) return;
    setTxLoading(true);
    try {
      const userDocRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
      await setDoc(userDocRef, { ...userData, isAdmin: true });
      showToast("Sei diventato Amministratore di Corfù Bets!");
    } catch (err) {
      console.error(err);
      showToast("Errore privilegi admin", true);
    } finally {
      setTxLoading(false);
    }
  };

  // ----------------------------------------------------------------------
  // 5. TRANSAZIONE DI PIAZZAMENTO SCOMMESSA
  // ----------------------------------------------------------------------
  const placeWager = async (marketId, choice, amountStr) => {
    const amount = parseInt(amountStr, 10);
    if (isNaN(amount) || amount <= 0) {
      showToast("Inserisci un importo valido.", true);
      return;
    }

    if (!user || !userData) return;
    if (userData.balance < amount) {
      showToast("Crediti insufficienti per questa puntata!", true);
      return;
    }

    const market = markets.find(m => m.id === marketId);
    if (!market) return;

    if (!market.isPreVacation) {
      const now = new Date();
      const hours = now.getHours();
      if (hours < 10 || hours >= 21) {
        showToast("Le scommesse standard sono aperte solo dalle 10:00 alle 21:00!", true);
        return;
      }
    }

    setTxLoading(true);
    try {
      const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', user.uid);
      const marketRef = doc(db, 'artifacts', appId, 'public', 'data', 'markets', marketId);
      const newWagerRef = doc(getWagersCollection());

      await runTransaction(db, async (transaction) => {
        const userSnap = await transaction.get(userRef);
        if (!userSnap.exists()) throw new Error("Utente non trovato.");
        const currentBalance = userSnap.data().balance;
        if (currentBalance < amount) throw new Error("Saldo insufficiente.");

        const marketSnap = await transaction.get(marketRef);
        if (!marketSnap.exists()) throw new Error("Mercato non trovato.");
        const mData = marketSnap.data();

        if (mData.status !== 'ACTIVE') throw new Error("Scommessa non più attiva!");

        if (mData.freezeTime) {
          const fTime = mData.freezeTime.toDate();
          if (new Date() >= fTime) throw new Error("L'evento è già iniziato.");
        }

        transaction.update(userRef, { balance: currentBalance - amount });

        const isOptionA = choice === 'A';
        const updatedPoolA = mData.poolA + (isOptionA ? amount : 0);
        const updatedPoolB = mData.poolB + (isOptionA ? 0 : amount);
        const updatedTotal = mData.totalPool + amount;

        transaction.update(marketRef, {
          poolA: updatedPoolA,
          poolB: updatedPoolB,
          totalPool: updatedTotal
        });

        transaction.set(newWagerRef, {
          id: newWagerRef.id,
          marketId: marketId,
          userId: user.uid,
          userName: userData.displayName,
          choice: choice,
          amount: amount,
          timestamp: Timestamp.now()
        });
      });

      showToast(`Scommessa di ${amount} TK piazzata con successo!`);
    } catch (err) {
      console.error("Transazione fallita:", err);
      showToast(err.message || "Impossibile completare la giocata.", true);
    } finally {
      setTxLoading(false);
    }
  };

  // ----------------------------------------------------------------------
  // 6. CREAZIONE MERCATI DA PARTE DI UN UTENTE
  // ----------------------------------------------------------------------
  const handleCreateMarket = async (e) => {
    e.preventDefault();
    const { title, optionA, optionB, isPreVacation, freezeHours } = newMarket;

    if (!title.trim() || !optionA.trim() || !optionB.trim()) {
      showToast("Compila tutti i campi obbligatori.", true);
      return;
    }

    setTxLoading(true);
    try {
      const newMarketRef = doc(getMarketsCollection());
      let freezeTimestamp = null;

      if (freezeHours && parseInt(freezeHours, 10) > 0) {
        const date = new Date();
        date.setMinutes(date.getMinutes() + parseInt(freezeHours, 10));
        freezeTimestamp = Timestamp.fromDate(date);
      }

      const marketData = {
        id: newMarketRef.id,
        title: title.trim(),
        optionA: optionA.trim(),
        optionB: optionB.trim(),
        creatorId: user.uid,
        createdAt: Timestamp.now(),
        status: 'ACTIVE',
        isPreVacation: !!isPreVacation,
        freezeTime: freezeTimestamp,
        poolA: 0,
        poolB: 0,
        totalPool: 0,
        outcome: null
      };

      await setDoc(newMarketRef, marketData);
      showToast(`Scommessa "${title}" creata ed è ora LIVE!`);
      setNewMarket({ title: '', optionA: '', optionB: '', isPreVacation: false, freezeHours: '' });
      setActiveTab('active-markets');
    } catch (err) {
      console.error(err);
      showToast("Impossibile salvare la scommessa.", true);
    } finally {
      setTxLoading(false);
    }
  };

  // ----------------------------------------------------------------------
  // 7. AMMINISTRAZIONE (CONGELAMENTO, RISOLUZIONE, CREDITI)
  // ----------------------------------------------------------------------
  const handleFreezeMarket = async (marketId) => {
    setTxLoading(true);
    try {
      const marketRef = doc(db, 'artifacts', appId, 'public', 'data', 'markets', marketId);
      await setDoc(marketRef, { status: 'FROZEN' }, { merge: true });
      showToast("Scommessa congelata.");
    } catch (err) {
      console.error(err);
    } finally {
      setTxLoading(false);
    }
  };

  const handleResolveMarket = async (marketId, outcome) => {
    if (outcome !== 'A' && outcome !== 'B') return;
    setTxLoading(true);
    try {
      const marketRef = doc(db, 'artifacts', appId, 'public', 'data', 'markets', marketId);
      
      await runTransaction(db, async (transaction) => {
        const marketSnap = await transaction.get(marketRef);
        const mData = marketSnap.data();

        if (mData.status === 'RESOLVED') throw new Error("Mercato già risolto.");

        const poolVincenti = outcome === 'A' ? mData.poolA : mData.poolB;
        const totalPool = mData.totalPool;
        const rimborsaTutti = poolVincenti === 0;
        const quota = rimborsaTutti ? 1.0 : (totalPool / poolVincenti);

        const wagersAssegnati = allWagers.filter(w => w.marketId === marketId);

        for (const wager of wagersAssegnati) {
          const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', wager.userId);
          const uSnap = await transaction.get(userRef);
          
          if (uSnap.exists()) {
            const currentBal = uSnap.data().balance;
            let vincita = 0;

            if (rimborsaTutti) {
              vincita = wager.amount;
            } else if (wager.choice === outcome) {
              vincita = Math.round(wager.amount * quota);
            }

            if (vincita > 0) {
              transaction.update(userRef, { balance: currentBal + vincita });
            }
          }
        }

        transaction.update(marketRef, {
          status: 'RESOLVED',
          outcome: outcome
        });
      });

      showToast(`Mercato risolto! Opzione vincente: ${outcome}.`);
    } catch (err) {
      console.error(err);
      showToast("Errore nella risoluzione.", true);
    } finally {
      setTxLoading(false);
    }
  };

  const handleCancelMarket = async (marketId) => {
    setTxLoading(true);
    try {
      const marketRef = doc(db, 'artifacts', appId, 'public', 'data', 'markets', marketId);

      await runTransaction(db, async (transaction) => {
        const marketSnap = await transaction.get(marketRef);
        const mData = marketSnap.data();

        const wagersAssegnati = allWagers.filter(w => w.marketId === marketId);

        for (const wager of wagersAssegnati) {
          const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', wager.userId);
          const uSnap = await transaction.get(userRef);
          if (uSnap.exists()) {
            const currentBal = uSnap.data().balance;
            transaction.update(userRef, { balance: currentBal + wager.amount });
          }
        }

        transaction.update(marketRef, { status: 'CANCELLED' });
      });

      showToast("Scommessa annullata e rimborsata.");
    } catch (err) {
      console.error(err);
    } finally {
      setTxLoading(false);
    }
  };

  const handleGiveCredits = async (targetUserId, amountToAdd) => {
    if (isNaN(amountToAdd) || amountToAdd === 0) return;
    setTxLoading(true);
    try {
      const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', targetUserId);
      await runTransaction(db, async (transaction) => {
        const uSnap = await transaction.get(userRef);
        const newBal = uSnap.data().balance + amountToAdd;
        transaction.update(userRef, { balance: Math.max(0, newBal) });
      });
      showToast(`Token aggiornati.`);
    } catch (err) {
      console.error(err);
    } finally {
      setTxLoading(false);
    }
  };

  const toggleUserAdminPrivilege = async (targetUserId, currentStatus) => {
    setTxLoading(true);
    try {
      const userRef = doc(db, 'artifacts', appId, 'public', 'data', 'users', targetUserId);
      await setDoc(userRef, { isAdmin: !currentStatus }, { merge: true });
      showToast(`Privilegi aggiornati.`);
    } catch (err) {
      console.error(err);
    } finally {
      setTxLoading(false);
    }
  };

  // ----------------------------------------------------------------------
  // UTILS DI CALCOLO
  // ----------------------------------------------------------------------
  const computeOdds = (pool, total) => {
    if (total === 0 || pool === 0) return "1.00";
    return (total / pool).toFixed(2);
  };

  const getStatusBadge = (status) => {
    switch (status) {
      case 'ACTIVE':
        return <span className="bg-green-500/20 text-green-400 border border-green-500/30 text-xs px-2 py-1 rounded">LIVE</span>;
      case 'FROZEN':
        return <span className="bg-yellow-500/20 text-yellow-400 border border-yellow-500/30 text-xs px-2 py-1 rounded">BLOCCATA</span>;
      case 'RESOLVED':
        return <span className="bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs px-2 py-1 rounded">RISOLTA</span>;
      case 'CANCELLED':
        return <span className="bg-red-500/20 text-red-400 border border-red-500/30 text-xs px-2 py-1 rounded">ANNULLATA</span>;
      default:
        return null;
    }
  };

  const formatTimeInfo = (market) => {
    if (market.status !== 'ACTIVE') return null;
    if (market.freezeTime) {
      const fDate = market.freezeTime.toDate();
      const diffMs = fDate - new Date();
      if (diffMs <= 0) return <span className="text-red-400 font-semibold text-xs">Chiuso</span>;
      const diffMins = Math.ceil(diffMs / 60000);
      if (diffMins < 60) return <span className="text-yellow-400 text-xs font-semibold">Chiude tra {diffMins} min</span>;
      return <span className="text-gray-400 text-xs">Chiude: {fDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>;
    }
    if (!market.isPreVacation) return <span className="text-emerald-400 text-xs">Oggi (10-21)</span>;
    return <span className="text-cyan-400 text-xs">Pre-Vacanza</span>;
  };

  const isTimeLocked = (market) => {
    if (market.isPreVacation) return false;
    const hours = new Date().getHours();
    return hours < 10 || hours >= 21;
  };

  // ----------------------------------------------------------------------
  // SCHERMATA DI LOGGING INIZIALE
  // ----------------------------------------------------------------------
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-4">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-emerald-500 mb-4"></div>
        <p className="text-slate-400">Caricamento di Corfù Bets...</p>
      </div>
    );
  }

  // Schermata di Autenticazione (Se l'utente non è loggato O non ha completato la registrazione)
  if (!user || !userData) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex flex-col justify-center items-center p-4">
        {/* Placeholder per ReCAPTCHA Invisibile */}
        <div id="recaptcha-container"></div>

        <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl">
          <div className="text-center mb-6">
            <h1 className="text-3xl font-black bg-gradient-to-r from-emerald-400 to-cyan-500 bg-clip-text text-transparent">
              CORFÙ BETS 🇬🇷
            </h1>
            <p className="text-xs text-emerald-400 uppercase tracking-widest mt-1">Scommesse Tra Amici</p>
          </div>

          {/* Tab di switch Accedi/Registrati */}
          <div className="flex border-b border-slate-800 mb-6">
            <button
              onClick={() => { setAuthTab('login'); setRegisterStep(1); }}
              className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all ${
                authTab === 'login' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400'
              }`}
            >
              Accedi
            </button>
            <button
              onClick={() => setAuthTab('register')}
              className={`flex-1 pb-3 text-sm font-bold border-b-2 transition-all ${
                authTab === 'register' ? 'border-emerald-500 text-emerald-400' : 'border-transparent text-slate-400'
              }`}
            >
              Registrati
            </button>
          </div>

          {authTab === 'login' ? (
            /* FORM DI LOGIN (USERNAME + PASSWORD) */
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-2">Username</label>
                <input
                  type="text"
                  required
                  placeholder="Inserisci il tuo username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-2">Password</label>
                <input
                  type="password"
                  required
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none"
                />
              </div>

              <button
                type="submit"
                disabled={txLoading}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 text-white font-bold py-3 rounded-xl transition shadow-lg"
              >
                {txLoading ? "Verifica in corso..." : "Entra nell'App"}
              </button>
            </form>
          ) : (
            /* CONFIGURAZIONE COMPLESSA DI REGISTRAZIONE (TELEFONO + VERIFICA + CREA ACCOUNT) */
            <div className="space-y-4">
              {registerStep === 1 && (
                /* Step 1: Telefono */
                <form onSubmit={handleSendSMS} className="space-y-4">
                  <p className="text-xs text-slate-400">
                    Per garantire che ognuno crei <strong>un solo account</strong>, invieremo un codice di verifica gratuito tramite SMS al tuo numero.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-2">Numero di Telefono (con +39)</label>
                    <input
                      type="tel"
                      required
                      placeholder="Es. +393331234567"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none text-white font-mono"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={txLoading}
                    className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 text-white font-bold py-3 rounded-xl"
                  >
                    {txLoading ? "Invio SMS in corso..." : "Invia Codice OTP"}
                  </button>
                </form>
              )}

              {registerStep === 2 && (
                /* Step 2: Codice OTP */
                <form onSubmit={handleVerifyOTP} className="space-y-4">
                  <p className="text-xs text-slate-400">
                    Inserisci il codice di 6 cifre ricevuto tramite SMS sul numero {phone}.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-2">Codice di Verifica</label>
                    <input
                      type="text"
                      required
                      placeholder="123456"
                      value={verificationCode}
                      onChange={(e) => setVerificationCode(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none text-center font-mono text-lg tracking-widest text-white"
                      maxLength={6}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setRegisterStep(1)}
                      className="w-1/3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-xl text-sm"
                    >
                      Indietro
                    </button>
                    <button
                      type="submit"
                      disabled={txLoading}
                      className="w-2/3 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-3 rounded-xl text-sm"
                    >
                      {txLoading ? "Verifica..." : "Verifica Codice"}
                    </button>
                  </div>
                </form>
              )}

              {registerStep === 3 && (
                /* Step 3: Username & Password finali */
                <form onSubmit={handleSetCredentials} className="space-y-4">
                  <p className="text-xs text-slate-400">
                    Numero di telefono verificato con successo! Imposta ora l'username e la password che utilizzerai d'ora in avanti per accedere rapidamente.
                  </p>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-2">Username Scelto</label>
                    <input
                      type="text"
                      required
                      placeholder="Esempio: pippo99"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 uppercase mb-2">Password (Minimo 6 caratteri)</label>
                    <input
                      type="password"
                      required
                      placeholder="Scegli una password sicura"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-3 text-sm focus:outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={txLoading}
                    className="w-full bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold py-3 rounded-xl"
                  >
                    {txLoading ? "Configurazione Account..." : "Completa la Registrazione"}
                  </button>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ----------------------------------------------------------------------
  // SCHERMATA APPLICAZIONE LOGGATA
  // ----------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* HEADER PRINCIPALE (STILE BOOKMAKER PREMIUM) */}
      <header className="sticky top-0 z-40 bg-slate-900 border-b border-slate-800 px-4 py-3 shadow-lg">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="text-2xl">🇬🇷</span>
            <div>
              <h1 className="text-xl font-black tracking-tight text-white flex items-center">
                CORFÙ <span className="text-emerald-400 ml-1">BETS</span>
              </h1>
              <span className="text-[10px] text-slate-400 font-mono block -mt-1">SUMMER 2026 EDITION</span>
            </div>
          </div>

          {/* Saldo, Profilo e Pulsante Disconnetti */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center space-x-2 bg-slate-950 border border-slate-800 rounded-full py-1.5 px-3">
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block font-medium leading-none uppercase">{userData.displayName}</span>
                <span className="text-sm font-bold text-emerald-400 font-mono tracking-wide">
                  {userData.balance.toLocaleString()} <span className="text-[10px] text-slate-500 font-normal">TK</span>
                </span>
              </div>
              <div className="h-8 w-8 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-500 flex items-center justify-center text-slate-950 font-bold uppercase text-xs">
                {userData.displayName.substring(0, 2)}
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="bg-slate-800 hover:bg-red-500/20 hover:text-red-400 text-slate-400 border border-slate-700/80 p-2 rounded-full transition"
              title="Disconnetti"
            >
              🚪
            </button>
          </div>
        </div>
      </header>

      {/* BANNER NOTIFICHE FLASH (TOAST) */}
      {errorMsg && (
        <div className="bg-red-500/90 text-white text-center py-2 px-4 text-xs font-semibold animate-pulse">
          ⚠️ {errorMsg}
        </div>
      )}
      {successMsg && (
        <div className="bg-emerald-500 text-slate-950 text-center py-2 px-4 text-xs font-bold shadow-md">
          ✅ {successMsg}
        </div>
      )}

      {/* SCHERMATA DELLE PUNTATE PRINCIPALI */}
      <main className="flex-1 max-w-6xl w-full mx-auto p-4 pb-24">
        
        {/* BANNER INFORMATIVO DI REGOLAMENTO */}
        <div className="bg-gradient-to-r from-slate-900 to-slate-950 border border-emerald-500/20 rounded-2xl p-4 mb-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-sm font-bold text-white uppercase tracking-wider mb-1">Totalizzatore Parimutuel Corfù</h2>
            <p className="text-xs text-slate-400 max-w-2xl">
              Le quote variano dinamicamente in base a quanto gli altri scommettono! Più scommetti su un'opzione snobbata dagli altri, più vinci in caso di esito corretto. L'anonimato delle giocate è garantito fino alla risoluzione dell'evento.
            </p>
          </div>
          <div className="flex gap-2">
            {!userData?.isAdmin && (
              <button 
                onClick={makeMeAdmin}
                className="text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 py-1 px-3 rounded-lg border border-slate-700 transition"
              >
                Diventa Amministratore (Test)
              </button>
            )}
            <div className="text-[11px] bg-emerald-500/10 text-emerald-400 py-1.5 px-3 rounded-lg border border-emerald-500/20 font-mono">
              Cash: Contanti
            </div>
          </div>
        </div>

        {/* CONTENUTO TAB DINAMICO */}
        {activeTab === 'active-markets' && (
          <section className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-white flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping"></span>
                Scommesse Aperte
              </h3>
              <span className="text-xs text-slate-400">Aggiornato in tempo reale</span>
            </div>

            {markets.filter(m => m.status === 'ACTIVE' || m.status === 'FROZEN').length === 0 ? (
              <div className="text-center py-12 bg-slate-900/50 border border-slate-800 rounded-2xl">
                <span className="text-4xl">🏝️</span>
                <p className="text-slate-400 mt-3 text-sm">Nessuna scommessa attiva al momento.</p>
                <p className="text-slate-500 text-xs mt-1">Sii il primo a proporne una divertente nell'apposita sezione!</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {markets
                  .filter(m => m.status === 'ACTIVE' || m.status === 'FROZEN')
                  .map((market) => {
                    const isFrozen = market.status === 'FROZEN';
                    const lockedTime = isTimeLocked(market);
                    const isPlayable = !isFrozen && !lockedTime;
                    
                    const qA = computeOdds(market.poolA, market.totalPool);
                    const qB = computeOdds(market.poolB, market.totalPool);

                    const userWagersOnThis = myWagers.filter(w => w.marketId === market.id);
                    const totalMyBet = userWagersOnThis.reduce((acc, curr) => acc + curr.amount, 0);

                    return (
                      <div key={market.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col justify-between">
                        
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div className="flex flex-wrap gap-1.5 items-center">
                            {getStatusBadge(market.status)}
                            {market.isPreVacation && (
                              <span className="bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 text-[10px] px-1.5 py-0.5 rounded uppercase font-semibold">PRE-VACANZA</span>
                            )}
                          </div>
                          <div className="text-right">
                            {formatTimeInfo(market)}
                          </div>
                        </div>

                        <h4 className="text-base font-bold text-white mb-4 leading-snug">
                          {market.title}
                        </h4>

                        <div className="grid grid-cols-2 gap-3 mb-4">
                          {/* Opzione A */}
                          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 hover:border-slate-700 transition">
                            <span className="text-xs text-slate-400 block truncate font-medium">{market.optionA}</span>
                            <div className="flex items-baseline justify-between mt-1">
                              <span className="text-slate-500 text-[10px]">Quota</span>
                              <span className="text-lg font-black text-emerald-400 font-mono">{qA}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono block mt-1">Tot: {market.poolA} TK</span>
                            
                            {isPlayable && (
                              <div className="mt-3">
                                <QuickBetForm 
                                  choice="A" 
                                  optionName={market.optionA}
                                  onBet={(amount) => placeWager(market.id, 'A', amount)} 
                                />
                              </div>
                            )}
                          </div>

                          {/* Opzione B */}
                          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 hover:border-slate-700 transition">
                            <span className="text-xs text-slate-400 block truncate font-medium">{market.optionB}</span>
                            <div className="flex items-baseline justify-between mt-1">
                              <span className="text-slate-500 text-[10px]">Quota</span>
                              <span className="text-lg font-black text-emerald-400 font-mono">{qB}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono block mt-1">Tot: {market.poolB} TK</span>

                            {isPlayable && (
                              <div className="mt-3">
                                <QuickBetForm 
                                  choice="B" 
                                  optionName={market.optionB}
                                  onBet={(amount) => placeWager(market.id, 'B', amount)} 
                                />
                              </div>
                            )}
                          </div>
                        </div>

                        {lockedTime && market.status === 'ACTIVE' && (
                          <p className="text-[11px] text-yellow-400/80 bg-yellow-500/10 p-2 rounded-lg text-center mb-3">
                            ⏰ Gioco chiuso temporaneamente. Orario scommesse: 10:00 - 21:00.
                          </p>
                        )}

                        {isFrozen && (
                          <p className="text-[11px] text-yellow-400 bg-slate-950/40 p-2 rounded-lg text-center mb-3 font-semibold">
                            🔒 Scommesse congelate. Evento in corso!
                          </p>
                        )}

                        <div className="border-t border-slate-800/60 pt-3 mt-1 flex justify-between items-center text-xs text-slate-400">
                          <span>Totalizzatore scommessa:</span>
                          <span className="font-mono text-white font-semibold">{market.totalPool} TK</span>
                        </div>
                        
                        {totalMyBet > 0 && (
                          <div className="mt-2 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 flex justify-between items-center">
                            <span className="text-xs font-semibold text-emerald-400">Hai puntato:</span>
                            <div className="text-right">
                              {userWagersOnThis.map((w, idx) => (
                                <span key={idx} className="inline-block bg-slate-950/60 font-mono font-bold text-xs text-white px-2 py-0.5 rounded ml-1">
                                  {w.amount} TK su {w.choice === 'A' ? market.optionA : market.optionB}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}

        {activeTab === 'history' && (
          <section className="space-y-6">
            <h3 className="text-lg font-bold text-white">Storico e Risolte</h3>

            {markets.filter(m => m.status === 'RESOLVED' || m.status === 'CANCELLED').length === 0 ? (
              <div className="text-center py-12 bg-slate-900/50 border border-slate-800 rounded-2xl">
                <span className="text-4xl">📂</span>
                <p className="text-slate-400 mt-3 text-sm">Nessuna scommessa archiviata ancora.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {markets
                  .filter(m => m.status === 'RESOLVED' || m.status === 'CANCELLED')
                  .map((market) => {
                    const isCancelled = market.status === 'CANCELLED';
                    const winChoice = market.outcome;
                    const winningOptionText = winChoice === 'A' ? market.optionA : market.optionB;
                    const finalQuota = winChoice === 'A' 
                      ? computeOdds(market.poolA, market.totalPool) 
                      : computeOdds(market.poolB, market.totalPool);

                    const relatedWagers = allWagers.filter(w => w.marketId === market.id);

                    return (
                      <div key={market.id} className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-md">
                        <div className="flex justify-between items-center mb-3">
                          {getStatusBadge(market.status)}
                          <span className="text-[11px] text-slate-500 font-mono">
                            Pool: {market.totalPool} TK
                          </span>
                        </div>

                        <h4 className="text-base font-bold text-white mb-2">{market.title}</h4>

                        {isCancelled ? (
                          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-3 rounded-xl mb-4">
                            Scommessa annullata. Tutti i token investiti sono stati rimborsati.
                          </div>
                        ) : (
                          <div className="bg-slate-950/60 p-3.5 rounded-xl border border-slate-800/80 mb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
                            <div>
                              <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold">Opzione Vincente</span>
                              <span className="text-base font-extrabold text-emerald-400">{winningOptionText}</span>
                            </div>
                            <div className="sm:text-right">
                              <span className="text-[10px] text-slate-400 uppercase tracking-widest block font-bold">Quota Chiusura</span>
                              <span className="text-lg font-black font-mono text-white">{finalQuota}</span>
                            </div>
                          </div>
                        )}

                        <div className="border-t border-slate-800/60 pt-4 mt-2">
                          <h5 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                            🗣️ Chi ha scommesso cosa (Rivelazione):
                          </h5>
                          {relatedWagers.length === 0 ? (
                            <p className="text-xs text-slate-500 italic">Nessun piazzamento registrato.</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {relatedWagers.map((wager) => {
                                const didWin = wager.choice === winChoice && !isCancelled;
                                const isMyWager = wager.userId === user.uid;
                                
                                let winAmount = 0;
                                if (didWin) {
                                  const q = winChoice === 'A' ? (market.totalPool / market.poolA) : (market.totalPool / market.poolB);
                                  winAmount = Math.round(wager.amount * q);
                                }

                                return (
                                  <div 
                                    key={wager.id} 
                                    className={`text-xs p-2.5 rounded-lg border flex justify-between items-center ${
                                      isCancelled
                                        ? 'bg-slate-950/20 border-slate-800/60 text-slate-400'
                                        : didWin
                                          ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'
                                          : 'bg-slate-950/50 border-slate-800 text-slate-400'
                                    }`}
                                  >
                                    <div>
                                      <span className="font-bold text-white">
                                        {wager.userName} {isMyWager && <span className="text-[10px] text-cyan-400">(Tu)</span>}
                                      </span>
                                      <span className="text-slate-400 block text-[10px]">
                                        Ha puntato {wager.amount} TK su <strong className="text-slate-300">{wager.choice === 'A' ? market.optionA : market.optionB}</strong>
                                      </span>
                                    </div>
                                    <div className="text-right">
                                      {isCancelled ? (
                                        <span className="font-semibold text-[10px] text-slate-400">Rimborsato</span>
                                      ) : didWin ? (
                                        <div className="font-black text-xs text-emerald-400 font-mono">
                                          +{winAmount} TK
                                        </div>
                                      ) : (
                                        <span className="text-red-400 font-semibold font-mono text-[10px]">- {wager.amount} TK</span>
                                      )}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </section>
        )}

        {activeTab === 'create-market' && (
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 shadow-xl max-w-2xl mx-auto">
            <div className="text-center mb-6">
              <span className="text-3xl">💡</span>
              <h3 className="text-xl font-bold text-white mt-2">Crea Nuova Scommessa</h3>
              <p className="text-xs text-slate-400 mt-1">Sfida i tuoi amici in vacanza!</p>
            </div>

            <form onSubmit={handleCreateMarket} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                  Domanda / Descrizione della scommessa *
                </label>
                <input
                  type="text"
                  required
                  placeholder="Es. Quanti gyros pita mangerà Luca stasera?"
                  value={newMarket.title}
                  onChange={(e) => setNewMarket({ ...newMarket, title: e.target.value })}
                  className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none transition-colors"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Opzione A *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Es. Più di 3 (Over)"
                    value={newMarket.optionA}
                    onChange={(e) => setNewMarket({ ...newMarket, optionA: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none transition-colors"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
                    Opzione B *
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="Es. Massimo 3 (Under)"
                    value={newMarket.optionB}
                    onChange={(e) => setNewMarket({ ...newMarket, optionB: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-3 text-white placeholder-slate-600 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              <div className="bg-slate-950 border border-slate-800/80 rounded-xl p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-xs font-semibold text-slate-200 uppercase tracking-wider">
                      Modalità Pre-Vacanza
                    </label>
                    <span className="text-[10px] text-slate-500 block">Sblocca il limite di orario giornaliero per questa quota</span>
                  </div>
                  <input
                    type="checkbox"
                    checked={newMarket.isPreVacation}
                    onChange={(e) => setNewMarket({ ...newMarket, isPreVacation: e.target.checked })}
                    className="h-5 w-5 accent-emerald-500 rounded bg-slate-900 border-slate-800 text-emerald-500"
                  />
                </div>

                <div className="border-t border-slate-800/60 pt-3">
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">
                    Chiusura automatica (Minuti da adesso)
                  </label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Es. 60 per chiudere tra un'ora"
                    value={newMarket.freezeHours}
                    onChange={(e) => setNewMarket({ ...newMarket, freezeHours: e.target.value })}
                    className="w-full bg-slate-950 border border-slate-800 focus:border-emerald-500 rounded-xl px-4 py-2.5 text-white placeholder-slate-600 focus:outline-none transition-colors"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={txLoading}
                className="w-full bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 disabled:opacity-50 text-white font-bold py-3 px-4 rounded-xl transition-all shadow-lg shadow-emerald-950/40 text-sm"
              >
                {txLoading ? "Salvataggio..." : "Pubblica ed Attiva"}
              </button>
            </form>
          </section>
        )}

        {/* TAB PANNELLO ADMIN */}
        {activeTab === 'admin' && userData?.isAdmin && (
          <section className="space-y-6">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
              <div>
                <h3 className="text-xl font-bold text-white">⚙️ Pannello Amministratore</h3>
                <p className="text-xs text-slate-400">Risoluzione eventi, rimborsi e ricariche crediti reali.</p>
              </div>
              <div className="bg-slate-900 border border-slate-800 py-1.5 px-3 rounded-lg text-xs font-mono text-emerald-400">
                Amministratore: {userData.displayName}
              </div>
            </div>

            {/* PARTE A: GESTIONE MERCATI CORRENTI */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 border-b border-slate-800 pb-2">
                Sotto Esame / Da Risolvere
              </h4>

              {markets.filter(m => m.status === 'ACTIVE' || m.status === 'FROZEN').length === 0 ? (
                <p className="text-xs text-slate-500 italic py-4">Nessun mercato attivo o congelato.</p>
              ) : (
                <div className="space-y-4">
                  {markets
                    .filter(m => m.status === 'ACTIVE' || m.status === 'FROZEN')
                    .map((m) => {
                      return (
                        <div key={m.id} className="bg-slate-950/50 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                          <div className="space-y-1">
                            <div className="flex gap-2 items-center">
                              {getStatusBadge(m.status)}
                              <span className="text-[10px] text-slate-400 font-mono">Tot: {m.totalPool} TK</span>
                            </div>
                            <h5 className="text-sm font-bold text-white">{m.title}</h5>
                            <p className="text-[11px] text-slate-400">
                              A: <strong>{m.optionA}</strong> ({m.poolA} TK) | B: <strong>{m.optionB}</strong> ({m.poolB} TK)
                            </p>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {m.status === 'ACTIVE' && (
                              <button
                                onClick={() => handleFreezeMarket(m.id)}
                                className="bg-yellow-500 hover:bg-yellow-600 text-slate-950 text-xs font-bold py-1.5 px-3 rounded-lg transition"
                              >
                                Congela
                              </button>
                            )}

                            <button
                              onClick={() => handleResolveMarket(m.id, 'A')}
                              disabled={m.poolA === 0 && m.poolB === 0}
                              className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-30 text-slate-950 text-xs font-bold py-1.5 px-3 rounded-lg transition"
                            >
                              Vince A
                            </button>

                            <button
                              onClick={() => handleResolveMarket(m.id, 'B')}
                              disabled={m.poolA === 0 && m.poolB === 0}
                              className="bg-emerald-500 hover:bg-emerald-600 disabled:opacity-30 text-slate-950 text-xs font-bold py-1.5 px-3 rounded-lg transition"
                            >
                              Vince B
                            </button>

                            <button
                              onClick={() => handleCancelMarket(m.id)}
                              className="bg-red-500/20 hover:bg-red-500 text-red-400 hover:text-white border border-red-500/30 text-xs font-bold py-1.5 px-3 rounded-lg transition"
                            >
                              Annulla
                            </button>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>

            {/* PARTE B: GESTIONE PORTAFOGLIO UTENTI */}
            <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
              <h4 className="text-sm font-bold text-slate-200 uppercase tracking-wider mb-4 border-b border-slate-800 pb-2">
                Ricarica Portafogli Token
              </h4>
              <p className="text-xs text-slate-400 mb-4">
                Quando un amico ti versa dei contanti, ricarica manualmente il suo portafoglio virtuale.
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-slate-800 text-slate-400">
                      <th className="py-2">Amico</th>
                      <th className="py-2">Ruolo</th>
                      <th className="py-2 text-right">Saldo Token</th>
                      <th className="py-2 text-center">Ricarica rapida</th>
                      <th className="py-2 text-right font-mono">Modifica Ruolo</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60">
                    {allUsers.map((u) => {
                      return (
                        <tr key={u.uid} className="hover:bg-slate-800/30">
                          <td className="py-3 font-bold text-white">
                            {u.displayName} {u.uid === user.uid && <span className="text-[10px] text-cyan-400">(Tu)</span>}
                          </td>
                          <td className="py-3">
                            {u.isAdmin ? (
                              <span className="bg-red-500/10 text-red-400 text-[10px] font-bold px-1.5 py-0.5 rounded">ADMIN</span>
                            ) : (
                              <span className="text-slate-500 text-[10px]">Giocatore</span>
                            )}
                          </td>
                          <td className="py-3 text-right font-bold text-emerald-400 font-mono">
                            {u.balance} TK
                          </td>
                          <td className="py-3 text-center">
                            <div className="flex justify-center gap-1">
                              <button
                                onClick={() => handleGiveCredits(u.uid, 500)}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded text-[10px]"
                              >
                                +500 TK
                              </button>
                              <button
                                onClick={() => handleGiveCredits(u.uid, 1000)}
                                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-2 py-1 rounded text-[10px]"
                              >
                                +1000 TK
                              </button>
                              <button
                                onClick={() => {
                                  const custom = parseInt(prompt("Aggiungi o togli (con il segno meno) una quota:"), 10);
                                  if (!isNaN(custom)) handleGiveCredits(u.uid, custom);
                                }}
                                className="bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-slate-950 px-2 py-1 rounded text-[10px] border border-emerald-500/20"
                              >
                                Altro...
                              </button>
                            </div>
                          </td>
                          <td className="py-3 text-right">
                            <button
                              onClick={() => toggleUserAdminPrivilege(u.uid, u.isAdmin)}
                              className="text-[10px] text-slate-400 hover:text-white underline"
                              disabled={u.uid === user.uid}
                            >
                              {u.isAdmin ? "Rimuovi Admin" : "Rendi Admin"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}

      </main>

      {/* NAVBAR DI NAVIGAZIONE IN BASSO */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-slate-900 border-t border-slate-800 py-2 px-4 shadow-xl">
        <div className="max-w-md mx-auto flex justify-between items-center text-center">
          
          <button
            onClick={() => setActiveTab('active-markets')}
            className={`flex-1 py-1 flex flex-col items-center gap-1 transition ${
              activeTab === 'active-markets' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="text-lg">🔥</span>
            <span className="text-[10px] uppercase tracking-wider font-semibold">Scommesse</span>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 py-1 flex flex-col items-center gap-1 transition ${
              activeTab === 'history' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="text-lg">📂</span>
            <span className="text-[10px] uppercase tracking-wider font-semibold">Storico</span>
          </button>

          <button
            onClick={() => setActiveTab('create-market')}
            className={`flex-1 py-1 flex flex-col items-center gap-1 transition ${
              activeTab === 'create-market' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className="text-lg">💡</span>
            <span className="text-[10px] uppercase tracking-wider font-semibold">Proponi</span>
          </button>

          {userData?.isAdmin && (
            <button
              onClick={() => setActiveTab('admin')}
              className={`flex-1 py-1 flex flex-col items-center gap-1 transition ${
                activeTab === 'admin' ? 'text-emerald-400 font-bold' : 'text-slate-400 hover:text-white'
              }`}
            >
              <span className="text-lg">⚙️</span>
              <span className="text-[10px] uppercase tracking-wider font-semibold">Admin</span>
            </button>
          )}

        </div>
      </nav>
    </div>
  );
}

// Componente Locale: FORM DI PUNTATA VELOCE
function QuickBetForm({ choice, optionName, onBet }) {
  const [betAmount, setBetAmount] = useState('50');
  const [showInput, setShowInput] = useState(false);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!betAmount || parseInt(betAmount, 10) <= 0) return;
    onBet(betAmount);
    setShowInput(false);
  };

  if (!showInput) {
    return (
      <button
        onClick={() => setShowInput(true)}
        className="w-full bg-emerald-500/10 hover:bg-emerald-500 text-emerald-400 hover:text-slate-950 border border-emerald-500/20 font-bold py-1.5 px-2 rounded-lg text-xs transition duration-200"
      >
        Punta
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2">
      <div className="flex gap-1.5">
        <input
          type="number"
          required
          min="1"
          value={betAmount}
          onChange={(e) => setBetAmount(e.target.value)}
          placeholder="TK"
          className="w-full bg-slate-950 border border-emerald-500/40 text-white font-mono text-xs rounded-lg px-2 py-1 focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          className="bg-emerald-500 text-slate-950 hover:bg-emerald-400 font-extrabold text-xs px-2.5 py-1 rounded-lg transition"
        >
          OK
        </button>
      </div>
      <div className="flex justify-between items-center text-[10px]">
        <button type="button" onClick={() => setBetAmount('20')} className="text-slate-500 hover:text-white">20</button>
        <button type="button" onClick={() => setBetAmount('50')} className="text-slate-500 hover:text-white">50</button>
        <button type="button" onClick={() => setBetAmount('100')} className="text-slate-500 hover:text-white font-bold">100</button>
        <button type="button" onClick={() => setShowInput(false)} className="text-red-400 font-semibold">X</button>
      </div>
    </form>
  );
}