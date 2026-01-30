import { getAuth } from "firebase/auth";
import app from "./index";

const auth = getAuth(app);

export default auth;
