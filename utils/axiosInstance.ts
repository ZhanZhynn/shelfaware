import axios from "axios";

const axiosInstance = axios.create({
  baseURL: process.env.NODE_ENV === "production" ? "/api" : "/api",
  headers: {
    "Content-Type": "application/json",
  },
  withCredentials: true, // Ensure cookies are sent with requests
});

export default axiosInstance;
