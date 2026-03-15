import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useAuthStore } from "../store/authStore";
import { HeartHandshake, AlertCircle } from "lucide-react";
import type { LoginFormValues } from "../types";

export default function LoginPage() {
  const navigate = useNavigate();
  const login = useAuthStore((s) => s.login);
  const [serverError, setServerError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [rememberMe, setRememberMe] = useState(
    () => !!localStorage.getItem("remembered_email")
  );

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<LoginFormValues>();

  useEffect(() => {
    const saved = localStorage.getItem("remembered_email");
    if (saved) setValue("email", saved);
  }, [setValue]);

  const onSubmit = async (values: LoginFormValues) => {
    setServerError("");
    setIsSubmitting(true);
    try {
      await login(values.email, values.password);
      if (rememberMe) {
        localStorage.setItem("remembered_email", values.email);
      } else {
        localStorage.removeItem("remembered_email");
      }
      navigate("/dashboard", { replace: true });
    } catch {
      setServerError("帳號或密碼錯誤，請重新輸入");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-50 px-4 sm:px-6 lg:px-8">
      <div className="w-full max-w-md">
        
        {/* Card Container */}
        <div className="card px-6 py-10 sm:px-10 sm:py-12">
          {/* Brand Header */}
          <div className="mb-10 flex flex-col items-center text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-900 shadow-md">
              <HeartHandshake className="h-7 w-7 text-primary-500" />
            </div>
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-gray-900">
              CareVisit <span className="text-primary-600">.</span>
            </h1>
            <p className="mt-2 text-sm font-medium text-gray-500 uppercase tracking-widest">
              長照家電訪管理系統
            </p>
          </div>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
            {serverError && (
              <div className="flex items-center gap-2.5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-600">
                <AlertCircle className="h-5 w-5 shrink-0" />
                {serverError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="email"
                  className="mb-1.5 block text-sm font-semibold text-gray-900"
                >
                  電子信箱
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  className={`input-base ${
                    errors.email ? "border-red-400 focus:border-red-500 focus:ring-red-500/10" : ""
                  }`}
                  placeholder="name@example.com"
                  {...register("email", {
                    required: "請輸入電子信箱",
                    pattern: {
                      value: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                      message: "請輸入有效的電子信箱格式",
                    },
                  })}
                />
                {errors.email && (
                  <p className="mt-1.5 text-xs font-medium text-red-500">
                    {errors.email.message}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="password"
                  className="mb-1.5 block text-sm font-semibold text-gray-900"
                >
                  密碼
                </label>
                <input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  className={`input-base ${
                    errors.password ? "border-red-400 focus:border-red-500 focus:ring-red-500/10" : ""
                  }`}
                  placeholder="請輸入密碼"
                  {...register("password", {
                    required: "請輸入密碼",
                  })}
                />
                {errors.password && (
                  <p className="mt-1.5 text-xs font-medium text-red-500">
                    {errors.password.message}
                  </p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              <input
                id="rememberMe"
                type="checkbox"
                checked={rememberMe}
                onChange={(e) => setRememberMe(e.target.checked)}
                className="h-4 w-4 cursor-pointer rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <label
                htmlFor="rememberMe"
                className="cursor-pointer text-sm font-medium text-gray-600 select-none"
              >
                記住帳號
              </label>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary mt-2 w-full py-3.5 text-base"
            >
              {isSubmitting ? "登入中..." : "登入系統"}
            </button>
          </form>
        </div>
        
        {/* Footer Links */}
        <p className="mt-8 text-center text-xs font-medium text-gray-400">
          &copy; {new Date().getFullYear()} CareVisit. All rights reserved.
        </p>
      </div>
    </div>
  );
}
