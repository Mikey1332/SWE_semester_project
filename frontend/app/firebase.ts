import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDwlCFTkNcbXbnnDENMNUugkvopLh6_pTs",
  authDomain: "swe-project-auth.firebaseapp.com",
  projectId: "swe-project-auth",
  storageBucket: "swe-project-auth.firebasestorage.app",
  messagingSenderId: "733525236940",
  appId: "1:733525236940:web:8012555bc1fa664e49b669",
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);