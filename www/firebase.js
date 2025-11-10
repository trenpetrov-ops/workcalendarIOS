import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD8sQkXuuQl3FN05-GVqVQ_6wg6TCQ_WuU",
  authDomain: "trainer-calendar-601cc.firebaseapp.com",
  projectId: "trainer-calendar-601cc",
  storageBucket: "trainer-calendar-601cc.appspot.com",
  messagingSenderId: "658574673709",
  appId: "1:658574673709:web:d4454197751972ce7275a4",
  measurementId: "G-X66J83Z7SY"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
