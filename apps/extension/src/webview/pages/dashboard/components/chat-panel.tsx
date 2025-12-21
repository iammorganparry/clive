import { Loader2, Send } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../../../components/ui/button.js";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card.js";
import { Input } from "../../../../components/ui/input.js";
import type { VSCodeAPI } from "../../../services/vscode.js";
import { useRpc } from "../../../rpc/provider.js";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
}

interface ChatPanelProps {
  vscode: VSCodeAPI;
  sourceFile: string;
  conversationId?: string;
  initialMessages?: ChatMessage[];
}

const ChatPanel: React.FC<ChatPanelProps> = ({
  vscode: _vscode,
  sourceFile,
  conversationId: _conversationId,
  initialMessages = [],
}) => {
  const rpc = useRpc();
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Load conversation history
  const { data: historyData } = rpc.conversations.getHistory.useQuery({
    input: { sourceFile },
    enabled: !!sourceFile,
  });

  // Update messages when history loads
  useEffect(() => {
    if (historyData?.messages) {
      const historyMessages: ChatMessage[] = historyData.messages.map(
        (msg) => ({
          id: msg.id,
          role: msg.role as "user" | "assistant" | "system",
          content: msg.content,
          timestamp: new Date(msg.createdAt),
        }),
      );
      setMessages(historyMessages);
    }
  }, [historyData]);

  // Scroll to bottom when messages change
  // biome-ignore lint/correctness/useExhaustiveDependencies: We need to scroll to the bottom when the messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Start conversation if needed
  const startConversationMutation = rpc.conversations.start.useMutation();

  // Send message subscription
  const sendMessageSubscription = rpc.conversations.sendMessage.useSubscription(
    {
      enabled: false,
      onData: (data: unknown) => {
        const progress = data as {
          type?: string;
          content?: string;
          tests?: unknown[];
        };
        if (progress.type === "message" && progress.content) {
          const newMessage: ChatMessage = {
            id: `msg-${Date.now()}`,
            role: "assistant",
            content: progress.content,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, newMessage]);
          setIsLoading(false);
        } else if (progress.type === "tests") {
          // Handle tests if needed
          setIsLoading(false);
        }
      },
      onComplete: () => {
        setIsLoading(false);
      },
      onError: (error) => {
        const errorMessage: ChatMessage = {
          id: `error-${Date.now()}`,
          role: "system",
          content:
            error instanceof Error
              ? error.message
              : "An error occurred. Please try again.",
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, errorMessage]);
        setIsLoading(false);
      },
    },
  );

  const handleSendMessage = useCallback(async () => {
    if (!inputValue.trim() || isLoading) {
      return;
    }

    const userMessage: ChatMessage = {
      id: `msg-${Date.now()}`,
      role: "user",
      content: inputValue.trim(),
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    const messageContent = inputValue.trim();
    setInputValue("");
    setIsLoading(true);

    try {
      // Ensure we have a conversation
      let currentConversationId = _conversationId;
      if (!currentConversationId) {
        const conversation = await startConversationMutation.mutateAsync({
          sourceFile,
        });
        currentConversationId = conversation.conversationId;
      }

      // Send message via subscription
      sendMessageSubscription.subscribe({
        conversationId: currentConversationId,
        sourceFile,
        message: messageContent,
      });
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "system",
        content:
          error instanceof Error
            ? error.message
            : "An error occurred. Please try again.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
      setIsLoading(false);
    }
  }, [
    inputValue,
    isLoading,
    sourceFile,
    _conversationId,
    startConversationMutation,
    sendMessageSubscription,
  ]);

  const handleKeyPress = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    },
    [handleSendMessage],
  );

  return (
    <Card className="flex flex-col h-full max-h-[600px]">
      <CardHeader>
        <CardTitle>Chat with Planning Agent</CardTitle>
        <CardDescription>
          Discuss and refine the test plan for {sourceFile}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col flex-1 min-h-0 p-4">
        {/* Messages area */}
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 pr-2">
          {messages.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              Start a conversation to refine your test plan
            </div>
          ) : (
            messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${
                  message.role === "user"
                    ? "justify-end"
                    : message.role === "system"
                      ? "justify-center"
                      : "justify-start"
                }`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : message.role === "system"
                        ? "bg-destructive/10 text-destructive border border-destructive/20"
                        : "bg-muted"
                  }`}
                >
                  <div className="text-sm whitespace-pre-wrap">
                    {message.role === "system" && (
                      <span className="font-semibold">Error: </span>
                    )}
                    {message.content}
                  </div>
                  {message.role !== "system" && (
                    <div
                      className={`text-xs mt-1 ${
                        message.role === "user"
                          ? "text-primary-foreground/70"
                          : "text-muted-foreground"
                      }`}
                    >
                      {message.timestamp.toLocaleTimeString()}
                    </div>
                  )}
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-muted rounded-lg px-4 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input area */}
        <div className="flex gap-2">
          <Input
            value={inputValue}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setInputValue(e.target.value)
            }
            onKeyPress={handleKeyPress}
            placeholder="Type your message..."
            disabled={isLoading}
            className="flex-1"
          />
          <Button
            onClick={handleSendMessage}
            disabled={!inputValue.trim() || isLoading}
            size="icon"
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ChatPanel;
