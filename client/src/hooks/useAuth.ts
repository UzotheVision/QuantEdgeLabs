import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { User } from "@shared/schema";

export function useAuth() {
  const { data: user, isLoading, isError } = useQuery<User | null>({
    queryKey: ["/api/auth/me"],
    queryFn: async () => {
      try {
        const res = await fetch("/api/auth/me", {
          credentials: "include",
        });
        if (res.status === 401 || res.status === 403) {
          return null;
        }
        if (!res.ok) {
          return null; // Silently fail on error
        }
        return await res.json();
      } catch (error) {
        console.error("Auth check failed:", error);
        return null; // Default to not authenticated if error
      }
    },
    retry: false,
    staleTime: Infinity,
  });

  const logoutMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/auth/logout");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
    },
  });

  return {
    user,
    isLoading,
    isError,
    isAuthenticated: !!user,
    logout: logoutMutation.mutate,
  };
}
