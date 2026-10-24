// Transport only: Python owns supported methods and all API business logic.
export { forwardToBackend as GET, forwardToBackend as POST, forwardToBackend as PUT, forwardToBackend as PATCH, forwardToBackend as DELETE, forwardToBackend as HEAD, forwardToBackend as OPTIONS } from "@/lib/backend/proxy";
