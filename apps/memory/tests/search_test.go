package tests

import (
	"testing"

	"github.com/iammorganparry/clive/apps/memory/internal/search"
)

func TestCosineSimilarity(t *testing.T) {
	t.Run("identical vectors", func(t *testing.T) {
		a := []float32{1.0, 0.0, 0.0}
		sim := search.CosineSimilarity(a, a)
		if sim < 0.999 {
			t.Fatalf("expected ~1.0, got %f", sim)
		}
	})

	t.Run("orthogonal vectors", func(t *testing.T) {
		a := []float32{1.0, 0.0, 0.0}
		b := []float32{0.0, 1.0, 0.0}
		sim := search.CosineSimilarity(a, b)
		if sim > 0.001 || sim < -0.001 {
			t.Fatalf("expected ~0.0, got %f", sim)
		}
	})

	t.Run("opposite vectors", func(t *testing.T) {
		a := []float32{1.0, 0.0, 0.0}
		b := []float32{-1.0, 0.0, 0.0}
		sim := search.CosineSimilarity(a, b)
		if sim > -0.999 {
			t.Fatalf("expected ~-1.0, got %f", sim)
		}
	})

	t.Run("empty vectors", func(t *testing.T) {
		sim := search.CosineSimilarity([]float32{}, []float32{})
		if sim != 0 {
			t.Fatalf("expected 0 for empty vectors, got %f", sim)
		}
	})

	t.Run("mismatched lengths", func(t *testing.T) {
		a := []float32{1.0, 0.0}
		b := []float32{1.0, 0.0, 0.0}
		sim := search.CosineSimilarity(a, b)
		if sim != 0 {
			t.Fatalf("expected 0 for mismatched lengths, got %f", sim)
		}
	})

	t.Run("similar vectors", func(t *testing.T) {
		a := []float32{1.0, 0.5, 0.0}
		b := []float32{0.9, 0.6, 0.1}
		sim := search.CosineSimilarity(a, b)
		if sim < 0.95 {
			t.Fatalf("expected high similarity, got %f", sim)
		}
	})
}

func TestFloat32ByteConversion(t *testing.T) {
	t.Run("roundtrip", func(t *testing.T) {
		original := []float32{1.0, -0.5, 3.14, 0.0, -100.0}
		bytes := search.Float32ToBytes(original)
		restored := search.BytesToFloat32(bytes)

		if len(restored) != len(original) {
			t.Fatalf("length mismatch: %d != %d", len(restored), len(original))
		}
		for i := range original {
			if original[i] != restored[i] {
				t.Fatalf("value mismatch at %d: %f != %f", i, original[i], restored[i])
			}
		}
	})

	t.Run("empty", func(t *testing.T) {
		bytes := search.Float32ToBytes([]float32{})
		restored := search.BytesToFloat32(bytes)
		if len(restored) != 0 {
			t.Fatalf("expected empty, got %d", len(restored))
		}
	})

	t.Run("invalid byte length returns nil", func(t *testing.T) {
		result := search.BytesToFloat32([]byte{1, 2, 3})
		if result != nil {
			t.Fatal("expected nil for invalid byte length")
		}
	})
}
