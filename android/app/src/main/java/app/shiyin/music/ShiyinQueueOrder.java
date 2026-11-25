package app.shiyin.music;

import java.util.Random;

final class ShiyinQueueOrder {
    static int next(int index, int count, String mode, Random random) {
        if (count == 0) return -1;
        if ("单曲循环".equals(mode) && index >= 0) return index;
        if ("随机播放".equals(mode)) {
            if (index < 0) return random.nextInt(count);
            int offset = count > 1 ? 1 + random.nextInt(count - 1) : 0;
            return Math.floorMod(index + offset, count);
        }
        if ("顺序播放".equals(mode) && index == count - 1) return -1;
        return (index + 1) % count;
    }
}
