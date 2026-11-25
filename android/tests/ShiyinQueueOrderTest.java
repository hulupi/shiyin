package app.shiyin.music;



import java.util.Random;

public class ShiyinQueueOrderTest {
    private static void assertEquals(int expected, int actual) { if (expected != actual) throw new AssertionError(expected + " != " + actual); }
    private static void assertNotEquals(int expected, int actual) { if (expected == actual) throw new AssertionError("Repeated track " + actual); }
    private static void assertTrue(boolean value) { if (!value) throw new AssertionError("Index out of range"); }
    public static void main(String[] args) {
        emptyAndExhaustedSequentialQueuesStop();
        loopContinuesAcrossManyPasses();
        repeatKeepsCurrentTrack();
        randomAvoidsImmediateRepeatAndHandlesSingleTrack();
        System.out.println("Queue tests passed (4 scenarios, 2000 transitions)");
    }
    public static void emptyAndExhaustedSequentialQueuesStop() {
        assertEquals(-1, ShiyinQueueOrder.next(0, 0, "列表循环", new Random(1)));
        assertEquals(-1, ShiyinQueueOrder.next(9, 10, "顺序播放", new Random(1)));
    }
    public static void loopContinuesAcrossManyPasses() {
        int index = 0;
        for (int i = 1; i <= 1000; i++) {
            index = ShiyinQueueOrder.next(index, 10, "列表循环", new Random(1));
            assertEquals(i % 10, index);
        }
    }
    public static void repeatKeepsCurrentTrack() {
        assertEquals(4, ShiyinQueueOrder.next(4, 10, "单曲循环", new Random(1)));
    }
    public static void randomAvoidsImmediateRepeatAndHandlesSingleTrack() {
        Random random = new Random(42);
        int index = 0;
        for (int i = 0; i < 1000; i++) {
            int next = ShiyinQueueOrder.next(index, 10, "随机播放", random);
            assertTrue(next >= 0 && next < 10);
            assertNotEquals(index, next);
            index = next;
        }
        assertEquals(0, ShiyinQueueOrder.next(0, 1, "随机播放", random));
    }
}
